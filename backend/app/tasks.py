from __future__ import annotations

import io
import json
import shutil
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.converter import EngineChoice, convert_file


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskManager:
    def __init__(self, data_dir: Path, max_workers: int = 2) -> None:
        self.data_dir = data_dir
        self.tasks_dir = self.data_dir / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._recover_interrupted_tasks()

    def _recover_interrupted_tasks(self) -> None:
        """Re-queue tasks left in queued/processing state by a previous server process."""
        for task_dir in self.tasks_dir.iterdir():
            if not task_dir.is_dir():
                continue
            task_id = task_dir.name
            try:
                meta = self._read_meta(task_id)
            except (OSError, ValueError):
                continue
            if not meta or meta.get("status") not in ("queued", "processing"):
                continue
            source_path = self._find_source_path(task_id)
            if source_path is None:
                meta["status"] = "failed"
                meta["error"] = "Source file missing after server restart"
                meta["finished_at"] = _now_iso()
                self._write_meta(task_id, meta)
                continue
            meta["status"] = "queued"
            self._write_meta(task_id, meta)
            engine: EngineChoice = meta.get("engine_requested", "auto")
            self._executor.submit(self._run_task, task_id, source_path, engine)

    def _meta_path(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "meta.json"

    def _result_path(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "result.md"

    def _original_result_path(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "original.md"

    def _find_source_path(self, task_id: str) -> Path | None:
        task_dir = self.tasks_dir / task_id
        if not task_dir.exists():
            return None
        for child in task_dir.iterdir():
            if child.is_file() and child.name.startswith("source"):
                return child
        return None

    def _write_meta(self, task_id: str, meta: dict[str, Any]) -> None:
        path = self._meta_path(task_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def _read_meta(self, task_id: str) -> dict[str, Any] | None:
        path = self._meta_path(task_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def create_task(self, filename: str, content: bytes, engine: EngineChoice) -> dict[str, Any]:
        task_id = uuid.uuid4().hex[:12]
        task_dir = self.tasks_dir / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        safe_suffix = Path(filename).suffix or ".bin"
        source_path = task_dir / f"source{safe_suffix}"
        source_path.write_bytes(content)

        meta: dict[str, Any] = {
            "task_id": task_id,
            "filename": filename,
            "file_size": len(content),
            "engine_requested": engine,
            "engine_used": None,
            "status": "queued",
            "created_at": _now_iso(),
            "finished_at": None,
            "duration_ms": None,
            "error": None,
            "markdown_length": 0,
            "pinned": False,
            "edited": False,
        }
        with self._lock:
            self._write_meta(task_id, meta)

        self._executor.submit(self._run_task, task_id, source_path, engine)
        return meta

    def retry_task(self, task_id: str, engine: EngineChoice | None = None) -> dict[str, Any] | None:
        source_path = self._find_source_path(task_id)
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None or source_path is None:
                return None
            chosen_engine: EngineChoice = engine or meta.get("engine_requested", "auto")
            meta["engine_requested"] = chosen_engine
            meta["engine_used"] = None
            meta["status"] = "queued"
            meta["finished_at"] = None
            meta["duration_ms"] = None
            meta["error"] = None
            self._write_meta(task_id, meta)

        self._executor.submit(self._run_task, task_id, source_path, chosen_engine)
        return meta

    def update_markdown(self, task_id: str, markdown: str) -> dict[str, Any] | None:
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None or meta.get("status") != "completed":
                return None
            self._result_path(task_id).write_text(markdown, encoding="utf-8")
            orig_path = self._original_result_path(task_id)
            orig_md = orig_path.read_text(encoding="utf-8") if orig_path.exists() else markdown
            meta["markdown_length"] = len(markdown)
            meta["edited"] = markdown != orig_md
            self._write_meta(task_id, meta)
            data = dict(meta)
            data["markdown"] = markdown
            data["original_markdown"] = orig_md
            return data

    def _run_task(self, task_id: str, source_path: Path, engine: EngineChoice) -> None:
        started = time.perf_counter()
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None:
                return
            meta["status"] = "processing"
            self._write_meta(task_id, meta)

        try:
            markdown, used_engine = convert_file(source_path, engine)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            self._result_path(task_id).write_text(markdown, encoding="utf-8")
            self._original_result_path(task_id).write_text(markdown, encoding="utf-8")
            with self._lock:
                meta = self._read_meta(task_id)
                if meta is None:
                    return
                meta["status"] = "completed"
                meta["engine_used"] = used_engine
                meta["finished_at"] = _now_iso()
                meta["duration_ms"] = elapsed_ms
                meta["markdown_length"] = len(markdown)
                meta["edited"] = False
                self._write_meta(task_id, meta)
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            with self._lock:
                meta = self._read_meta(task_id)
                if meta is None:
                    return
                meta["status"] = "failed"
                meta["finished_at"] = _now_iso()
                meta["duration_ms"] = elapsed_ms
                meta["error"] = str(exc)
                self._write_meta(task_id, meta)

    def get_task(self, task_id: str, include_markdown: bool = True) -> dict[str, Any] | None:
        with self._lock:
            meta = self._read_meta(task_id)
        if meta is None:
            return None
        data = dict(meta)
        if include_markdown and meta.get("status") == "completed":
            result_path = self._result_path(task_id)
            orig_path = self._original_result_path(task_id)
            md = result_path.read_text(encoding="utf-8") if result_path.exists() else ""
            data["markdown"] = md
            data["original_markdown"] = orig_path.read_text(encoding="utf-8") if orig_path.exists() else md
        return data

    def list_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if not self.tasks_dir.exists():
            return items
        with self._lock:
            for task_dir in self.tasks_dir.iterdir():
                if not task_dir.is_dir():
                    continue
                try:
                    meta = self._read_meta(task_dir.name)
                except (OSError, ValueError):
                    continue
                if meta:
                    items.append(meta)
        items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return items[:limit]

    def get_result_file(self, task_id: str) -> tuple[Path, str] | None:
        meta = self._read_meta(task_id)
        if not meta or meta.get("status") != "completed":
            return None
        result_path = self._result_path(task_id)
        if not result_path.exists():
            return None
        stem = Path(meta["filename"]).stem or task_id
        return result_path, f"{stem}.md"

    def get_source_file(self, task_id: str) -> tuple[Path, str] | None:
        meta = self._read_meta(task_id)
        if not meta:
            return None
        source_path = self._find_source_path(task_id)
        if not source_path or not source_path.exists():
            return None
        return source_path, meta["filename"]

    def build_export_zip(self, task_ids: list[str] | None = None) -> bytes | None:
        tasks = self.list_tasks(limit=500)
        selected_set = set(task_ids) if task_ids else None

        buf = io.BytesIO()
        used_names: dict[str, int] = {}
        count = 0

        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for meta in tasks:
                tid = meta["task_id"]
                if selected_set is not None and tid not in selected_set:
                    continue
                if meta.get("status") != "completed":
                    continue
                result_path = self._result_path(tid)
                if not result_path.exists():
                    continue
                stem = Path(meta["filename"]).stem or tid
                idx = used_names.get(stem, 0)
                used_names[stem] = idx + 1
                arcname = f"{stem}.md" if idx == 0 else f"{stem}_{idx}.md"
                zf.writestr(arcname, result_path.read_text(encoding="utf-8"))
                count += 1

        if count == 0:
            return None
        return buf.getvalue()

    def rename_task(self, task_id: str, filename: str) -> dict[str, Any] | None:
        return self.update_task_meta(task_id, filename=filename)

    def update_task_meta(
        self,
        task_id: str,
        filename: str | None = None,
        pinned: bool | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None:
                return None
            if filename is not None:
                meta["filename"] = filename
            if pinned is not None:
                meta["pinned"] = pinned
            self._write_meta(task_id, meta)
            return dict(meta)

    def delete_task(self, task_id: str) -> bool:
        task_dir = self.tasks_dir / task_id
        if not task_dir.exists():
            return False
        with self._lock:
            shutil.rmtree(task_dir, ignore_errors=True)
        return True
