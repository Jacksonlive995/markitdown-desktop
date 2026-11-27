from __future__ import annotations

import io
import json
import queue
import re
import shutil
import threading
import time
import uuid
import zipfile
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.converter import (
    ConversionOptions,
    EngineChoice,
    TaskCancelledError,
    _build_frontmatter,
    convert_file,
)
from app.vlm import VlmConfig


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_stem(filename: str, fallback: str) -> str:
    stem = Path(filename).stem or fallback
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", stem).strip(" .")
    return cleaned or fallback


def _extract_snippet(text: str, query: str, radius: int = 48) -> str | None:
    lower_text = text.lower()
    lower_q = query.lower()
    idx = lower_text.find(lower_q)
    if idx < 0:
        return None
    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    snippet = text[start:end].replace("\r", " ").replace("\n", " ")
    snippet = re.sub(r"\s{2,}", " ", snippet).strip()
    if start > 0:
        snippet = f"…{snippet}"
    if end < len(text):
        snippet = f"{snippet}…"
    return snippet


class TaskManager:
    def __init__(self, data_dir: Path, max_workers: int = 2) -> None:
        self.data_dir = data_dir
        self.tasks_dir = self.data_dir / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._cache: dict[str, dict[str, Any]] = {}
        self._futures: dict[str, Future[Any]] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._subscribers_lock = threading.Lock()
        self._subscribers: set[queue.Queue[dict[str, Any]]] = set()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._load_cache_and_recover()

    def subscribe(self) -> queue.Queue[dict[str, Any]]:
        q: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=256)
        with self._subscribers_lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue[dict[str, Any]]) -> None:
        with self._subscribers_lock:
            self._subscribers.discard(q)

    def _emit_event(self, event_type: str, payload: dict[str, Any]) -> None:
        message = {"type": event_type, "task": payload, "ts": _now_iso()}
        with self._subscribers_lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(message)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(message)
                except queue.Empty:
                    pass

    def _load_cache_and_recover(self) -> None:
        """Load task metadata into memory cache and re-queue interrupted tasks."""
        to_recover: list[tuple[str, Path, EngineChoice, ConversionOptions]] = []
        for task_dir in self.tasks_dir.iterdir():
            if not task_dir.is_dir():
                continue
            task_id = task_dir.name
            try:
                meta = self._read_meta_disk(task_id)
            except (OSError, ValueError):
                continue
            if not meta:
                continue
            self._cache[task_id] = meta

            if meta.get("status") not in ("queued", "processing"):
                continue

            source_path = self._find_source_path(task_id)
            if source_path is None:
                meta["status"] = "failed"
                meta["error"] = "Source file missing after server restart"
                meta["finished_at"] = _now_iso()
                meta["progress_stage"] = "源文件丢失"
                self._write_meta(task_id, meta)
                continue

            meta["status"] = "queued"
            meta["progress_pct"] = 0
            meta["progress_stage"] = "服务重启后重新排队"
            self._write_meta(task_id, meta)
            engine: EngineChoice = meta.get("engine_requested", "auto")
            opts = self._options_from_meta(meta)
            to_recover.append((task_id, source_path, engine, opts))

        for task_id, source_path, engine, opts in to_recover:
            self._submit_task(task_id, source_path, engine, opts)

    def _options_from_meta(self, meta: dict[str, Any]) -> ConversionOptions:
        raw = meta.get("options") or {}
        return ConversionOptions(
            page_range=str(raw.get("page_range") or ""),
            ocr_mode=raw.get("ocr_mode") or "auto",
            extract_images=bool(raw.get("extract_images", True)),
            use_vlm=bool(raw.get("use_vlm", False)),
            frontmatter=bool(raw.get("frontmatter", False)),
            vlm=VlmConfig.from_dict_or_env(),
        )

    def _meta_path(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "meta.json"

    def _result_path(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "result.md"

    def _original_result_path(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "original.md"

    def _engine_snapshot_path(self, task_id: str, engine_name: str) -> Path:
        return self.tasks_dir / task_id / f"result_{engine_name}.md"

    def _assets_dir(self, task_id: str) -> Path:
        return self.tasks_dir / task_id / "assets"

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
        self._cache[task_id] = dict(meta)

    def _read_meta_disk(self, task_id: str) -> dict[str, Any] | None:
        path = self._meta_path(task_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def _read_meta(self, task_id: str) -> dict[str, Any] | None:
        cached = self._cache.get(task_id)
        if cached is not None:
            return dict(cached)
        disk = self._read_meta_disk(task_id)
        if disk is not None:
            self._cache[task_id] = dict(disk)
        return disk

    def _submit_task(
        self,
        task_id: str,
        source_path: Path,
        engine: EngineChoice,
        options: ConversionOptions,
    ) -> None:
        cancel_event = threading.Event()
        with self._lock:
            self._cancel_events[task_id] = cancel_event
            fut = self._executor.submit(self._run_task, task_id, source_path, engine, options, cancel_event)
            self._futures[task_id] = fut

    def create_task(
        self,
        filename: str,
        content: bytes,
        engine: EngineChoice,
        options: ConversionOptions | None = None,
        source_url: str | None = None,
    ) -> dict[str, Any]:
        opts = options or ConversionOptions()
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
            "progress_pct": 0,
            "progress_stage": "等待解析队列",
            "created_at": _now_iso(),
            "finished_at": None,
            "duration_ms": None,
            "error": None,
            "markdown_length": 0,
            "pinned": False,
            "edited": False,
            "assets": [],
            "engine_snapshots": [],
            "options": opts.to_meta_dict(),
            "source_url": source_url,
        }
        with self._lock:
            self._write_meta(task_id, meta)

        self._emit_event("task_created", dict(meta))
        self._submit_task(task_id, source_path, engine, opts)
        return meta

    def retry_task(
        self,
        task_id: str,
        engine: EngineChoice | None = None,
        options: ConversionOptions | None = None,
    ) -> dict[str, Any] | None:
        source_path = self._find_source_path(task_id)
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None or source_path is None:
                return None
            chosen_engine: EngineChoice = engine or meta.get("engine_requested", "auto")
            opts = options or self._options_from_meta(meta)
            meta["engine_requested"] = chosen_engine
            meta["engine_used"] = None
            meta["status"] = "queued"
            meta["progress_pct"] = 0
            meta["progress_stage"] = "等待重新解析"
            meta["finished_at"] = None
            meta["duration_ms"] = None
            meta["error"] = None
            meta["options"] = opts.to_meta_dict()
            self._write_meta(task_id, meta)

        self._emit_event("task_updated", dict(meta))
        self._submit_task(task_id, source_path, chosen_engine, opts)
        return meta

    def cancel_task(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None:
                return None
            if meta.get("status") not in ("queued", "processing"):
                return dict(meta)

            ev = self._cancel_events.get(task_id)
            if ev is not None:
                ev.set()
            fut = self._futures.get(task_id)
            if fut is not None:
                fut.cancel()

            meta["status"] = "cancelled"
            meta["progress_stage"] = "已取消"
            meta["finished_at"] = _now_iso()
            meta["error"] = "任务已被用户取消"
            self._write_meta(task_id, meta)
            result = dict(meta)

        self._emit_event("task_cancelled", result)
        return result

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
            data = self._attach_markdown_fields(task_id, meta, markdown, orig_md)
        self._emit_event("task_updated", dict(meta))
        return data

    def _attach_markdown_fields(
        self,
        task_id: str,
        meta: dict[str, Any],
        md: str,
        orig_md: str,
    ) -> dict[str, Any]:
        data = dict(meta)
        data["markdown"] = md
        data["original_markdown"] = orig_md
        engine_results: dict[str, str] = {}
        for eng in ("markitdown", "docling"):
            snap = self._engine_snapshot_path(task_id, eng)
            if snap.exists():
                try:
                    engine_results[eng] = snap.read_text(encoding="utf-8")
                except OSError:
                    pass
        if engine_results:
            data["engine_results"] = engine_results
        return data

    def _update_progress(self, task_id: str, pct: int, stage: str) -> None:
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None or meta.get("status") != "processing":
                return
            if meta.get("progress_pct") == pct and meta.get("progress_stage") == stage:
                return
            meta["progress_pct"] = pct
            meta["progress_stage"] = stage
            self._write_meta(task_id, meta)
            snapshot = dict(meta)
        self._emit_event("task_progress", snapshot)

    def _run_task(
        self,
        task_id: str,
        source_path: Path,
        engine: EngineChoice,
        options: ConversionOptions,
        cancel_event: threading.Event,
    ) -> None:
        started = time.perf_counter()
        with self._lock:
            meta = self._read_meta(task_id)
            if meta is None or meta.get("status") == "cancelled" or cancel_event.is_set():
                return
            meta["status"] = "processing"
            meta["progress_pct"] = 5
            meta["progress_stage"] = "准备解析环境"
            filename = meta.get("filename", source_path.name)
            source_url = meta.get("source_url")
            self._write_meta(task_id, meta)
            processing_snap = dict(meta)
        self._emit_event("task_progress", processing_snap)

        try:
            markdown, used_engine, assets = convert_file(
                source_path,
                engine,
                options=options,
                assets_dir=self._assets_dir(task_id),
                source_filename=filename,
                source_url=source_url,
                progress_cb=lambda pct, stage: self._update_progress(task_id, pct, stage),
                cancel_event=cancel_event,
            )
            if cancel_event.is_set():
                raise TaskCancelledError("任务已被用户取消")

            elapsed_ms = int((time.perf_counter() - started) * 1000)
            self._result_path(task_id).write_text(markdown, encoding="utf-8")
            self._original_result_path(task_id).write_text(markdown, encoding="utf-8")
            self._engine_snapshot_path(task_id, used_engine).write_text(markdown, encoding="utf-8")

            with self._lock:
                meta = self._read_meta(task_id)
                if meta is None or meta.get("status") == "cancelled":
                    return
                snapshots = list(meta.get("engine_snapshots") or [])
                if used_engine not in snapshots:
                    snapshots.append(used_engine)
                meta["status"] = "completed"
                meta["engine_used"] = used_engine
                meta["finished_at"] = _now_iso()
                meta["duration_ms"] = elapsed_ms
                meta["markdown_length"] = len(markdown)
                meta["edited"] = False
                meta["progress_pct"] = 100
                meta["progress_stage"] = "解析完成"
                meta["assets"] = assets
                meta["engine_snapshots"] = snapshots
                self._write_meta(task_id, meta)
                done_snap = dict(meta)
            self._emit_event("task_completed", done_snap)
        except TaskCancelledError:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            with self._lock:
                meta = self._read_meta(task_id)
                if meta is None:
                    return
                meta["status"] = "cancelled"
                meta["finished_at"] = _now_iso()
                meta["duration_ms"] = elapsed_ms
                meta["progress_stage"] = "已取消"
                meta["error"] = "任务已被用户取消"
                self._write_meta(task_id, meta)
                cancel_snap = dict(meta)
            self._emit_event("task_cancelled", cancel_snap)
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            with self._lock:
                meta = self._read_meta(task_id)
                if meta is None or meta.get("status") == "cancelled":
                    return
                meta["status"] = "failed"
                meta["finished_at"] = _now_iso()
                meta["duration_ms"] = elapsed_ms
                meta["progress_stage"] = "解析失败"
                meta["error"] = str(exc)
                self._write_meta(task_id, meta)
                fail_snap = dict(meta)
            self._emit_event("task_failed", fail_snap)
        finally:
            with self._lock:
                self._futures.pop(task_id, None)
                self._cancel_events.pop(task_id, None)

    def get_task(self, task_id: str, include_markdown: bool = True) -> dict[str, Any] | None:
        with self._lock:
            meta = self._read_meta(task_id)
        if meta is None:
            return None
        if include_markdown and meta.get("status") == "completed":
            result_path = self._result_path(task_id)
            orig_path = self._original_result_path(task_id)
            md = result_path.read_text(encoding="utf-8") if result_path.exists() else ""
            orig_md = orig_path.read_text(encoding="utf-8") if orig_path.exists() else md
            return self._attach_markdown_fields(task_id, meta, md, orig_md)
        return dict(meta)

    def list_tasks(self, limit: int = 100, q: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            all_items = [dict(m) for m in self._cache.values()]

        query = (q or "").strip()
        if not query:
            all_items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return all_items[:limit]

        lower_q = query.lower()
        matched: list[dict[str, Any]] = []
        for meta in all_items:
            name_hit = lower_q in str(meta.get("filename", "")).lower()
            snippet: str | None = None
            content_hit = False
            if meta.get("status") == "completed":
                res_path = self._result_path(meta["task_id"])
                if res_path.exists():
                    try:
                        text = res_path.read_text(encoding="utf-8")
                        snippet = _extract_snippet(text, query)
                        content_hit = snippet is not None
                    except OSError:
                        pass
            if name_hit or content_hit:
                item = dict(meta)
                if snippet:
                    item["match_snippet"] = snippet
                item["match_source"] = (
                    "both" if (name_hit and content_hit) else ("filename" if name_hit else "content")
                )
                matched.append(item)

        matched.sort(
            key=lambda x: (
                0 if x.get("match_source") in ("filename", "both") else 1,
                x.get("created_at", ""),
            ),
            reverse=False,
        )
        # Keep newest first within same match priority
        matched.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        matched.sort(key=lambda x: 0 if x.get("match_source") in ("filename", "both") else 1)
        return matched[:limit]

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

    def get_asset_file(self, task_id: str, filename: str) -> Path | None:
        assets_dir = self._assets_dir(task_id).resolve()
        if not assets_dir.exists():
            return None
        candidate = (assets_dir / Path(filename).name).resolve()
        if candidate.parent != assets_dir or not candidate.exists() or not candidate.is_file():
            return None
        return candidate

    def build_export_zip(self, task_ids: list[str] | None = None) -> bytes | None:
        tasks = self.list_tasks(limit=500)
        selected_set = set(task_ids) if task_ids else None

        eligible: list[dict[str, Any]] = []
        for meta in tasks:
            tid = meta["task_id"]
            if selected_set is not None and tid not in selected_set:
                continue
            if meta.get("status") != "completed":
                continue
            if not self._result_path(tid).exists():
                continue
            eligible.append(meta)

        if not eligible:
            return None

        buf = io.BytesIO()
        used_names: dict[str, int] = {}
        multi = len(eligible) > 1

        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for meta in eligible:
                tid = meta["task_id"]
                result_path = self._result_path(tid)
                stem = _safe_stem(meta["filename"], tid)
                idx = used_names.get(stem, 0)
                used_names[stem] = idx + 1
                doc_stem = stem if idx == 0 else f"{stem}_{idx}"
                md_content = result_path.read_text(encoding="utf-8")

                assets_dir = self._assets_dir(tid)
                asset_files = (
                    sorted(p for p in assets_dir.iterdir() if p.is_file())
                    if assets_dir.exists()
                    else []
                )

                if asset_files:
                    if multi:
                        # Namespace assets per document so multiple docs never collide
                        asset_prefix = f"assets/{doc_stem}"
                        md_content = re.sub(
                            r"(!\[[^\]]*\]\()assets/([^)\s]+\))",
                            rf"\1{asset_prefix}/\2",
                            md_content,
                        )
                        for asset in asset_files:
                            zf.write(asset, arcname=f"{asset_prefix}/{asset.name}")
                    else:
                        for asset in asset_files:
                            zf.write(asset, arcname=f"assets/{asset.name}")

                zf.writestr(f"{doc_stem}.md", md_content)

        return buf.getvalue()

    def export_to_vault(
        self,
        task_id: str,
        vault_path: str,
        *,
        subfolder: str = "MarkItDown",
        include_frontmatter: bool = True,
        markdown_override: str | None = None,
    ) -> dict[str, Any]:
        meta = self._read_meta(task_id)
        if not meta or meta.get("status") != "completed":
            raise FileNotFoundError("Completed task not found")

        vault_root = Path(vault_path).expanduser().resolve()
        if not vault_root.exists() or not vault_root.is_dir():
            raise ValueError(f"知识库目录不存在：{vault_root}")

        sub = subfolder.strip().strip("/\\")
        target_dir = (vault_root / sub).resolve() if sub else vault_root
        # Guard against escaping vault_root via '..'
        if vault_root != target_dir and vault_root not in target_dir.parents:
            raise ValueError("非法的子目录路径")
        target_dir.mkdir(parents=True, exist_ok=True)

        result_path = self._result_path(task_id)
        md_text = markdown_override if markdown_override is not None else result_path.read_text(encoding="utf-8")
        doc_stem = _safe_stem(meta["filename"], task_id)

        assets_dir = self._assets_dir(task_id)
        asset_files = (
            sorted(p for p in assets_dir.iterdir() if p.is_file())
            if assets_dir.exists()
            else []
        )

        assets_copied = 0
        if asset_files:
            dest_assets_dir = target_dir / "assets" / doc_stem
            dest_assets_dir.mkdir(parents=True, exist_ok=True)
            for asset in asset_files:
                shutil.copy2(asset, dest_assets_dir / asset.name)
                assets_copied += 1
            md_text = re.sub(
                r"(!\[[^\]]*\]\()assets/([^)\s]+\))",
                rf"\1assets/{doc_stem}/\2",
                md_text,
            )

        if include_frontmatter and not md_text.lstrip().startswith("---\n"):
            fm = _build_frontmatter(
                filename=meta["filename"],
                engine_used=meta.get("engine_used") or meta.get("engine_requested", "auto"),
                assets_count=assets_copied,
                source_url=meta.get("source_url"),
            )
            md_text = f"{fm}{md_text.lstrip()}"

        md_path = target_dir / f"{doc_stem}.md"
        md_path.write_text(md_text, encoding="utf-8")

        return {
            "md_path": str(md_path),
            "assets_dir": str(target_dir / "assets" / doc_stem) if assets_copied else None,
            "assets_copied": assets_copied,
        }

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
            updated = dict(meta)
        self._emit_event("task_updated", updated)
        return updated

    def delete_task(self, task_id: str) -> bool:
        task_dir = self.tasks_dir / task_id
        with self._lock:
            ev = self._cancel_events.get(task_id)
            if ev is not None:
                ev.set()
            fut = self._futures.get(task_id)
            if fut is not None:
                fut.cancel()
            existed = task_dir.exists() or (task_id in self._cache)
            self._cache.pop(task_id, None)
            if task_dir.exists():
                shutil.rmtree(task_dir, ignore_errors=True)
        if existed:
            self._emit_event("task_deleted", {"task_id": task_id})
        return existed
