from __future__ import annotations

import io
import time
import zipfile

from docx import Document
from fastapi.testclient import TestClient
from openpyxl import Workbook
from reportlab.pdfgen import canvas

from app.main import app

client = TestClient(app)


def _wait_task(task_id: str, timeout: float = 180.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/api/tasks/{task_id}")
        assert resp.status_code == 200
        data = resp.json()
        if data["status"] in ("completed", "failed"):
            return data
        time.sleep(0.3)
    raise TimeoutError(f"Task {task_id} did not finish within {timeout}s")


def _make_docx_bytes() -> bytes:
    doc = Document()
    doc.add_heading("Project Report", level=1)
    doc.add_paragraph("Hello from Word conversion test.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_xlsx_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Budget"
    ws.append(["Item", "Cost"])
    ws.append(["Server", 120])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _make_pdf_bytes() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 750, "Academic Paper Sample")
    c.drawString(72, 720, "This PDF tests Docling conversion.")
    c.save()
    return buf.getvalue()


def test_rejects_unsupported_extension() -> None:
    resp = client.post(
        "/api/convert",
        files={"file": ("malware.exe", b"MZ\x00\x00", "application/octet-stream")},
        data={"engine": "auto"},
    )
    assert resp.status_code == 415


def test_rename_task() -> None:
    resp = client.post(
        "/api/convert",
        files={"file": ("budget.xlsx", _make_xlsx_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"engine": "markitdown"},
    )
    task_id = resp.json()["task_id"]
    _wait_task(task_id)
    renamed = client.patch(f"/api/tasks/{task_id}", json={"filename": "季度预算.xlsx", "pinned": True})
    assert renamed.status_code == 200
    assert renamed.json()["filename"] == "季度预算.xlsx"
    assert renamed.json()["pinned"] is True
    detail = client.get(f"/api/tasks/{task_id}").json()
    assert detail["filename"] == "季度预算.xlsx"
    assert detail["pinned"] is True
    assert "original_markdown" in detail
    assert client.delete(f"/api/tasks/{task_id}").status_code == 200


def test_convert_text_snippet_and_batch_delete() -> None:
    resp = client.post(
        "/api/convert-text",
        json={
            "title": "网页摘录",
            "content": "<h1>Hello Snippet</h1><p>Converted from HTML snippet.</p>",
            "format": "html",
            "engine": "markitdown",
        },
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]
    result = _wait_task(task_id)
    assert result["status"] == "completed"
    assert "Hello Snippet" in result["markdown"]

    del_resp = client.post("/api/tasks/batch-delete", json={"task_ids": [task_id]})
    assert del_resp.status_code == 200
    assert task_id in del_resp.json()["deleted"]


def test_recovers_interrupted_tasks(tmp_path) -> None:
    import json

    from app.tasks import TaskManager

    task_dir = tmp_path / "tasks" / "abc123"
    task_dir.mkdir(parents=True)
    (task_dir / "source.xlsx").write_bytes(_make_xlsx_bytes())
    (task_dir / "meta.json").write_text(
        json.dumps(
            {
                "task_id": "abc123",
                "filename": "budget.xlsx",
                "file_size": 1,
                "engine_requested": "markitdown",
                "engine_used": None,
                "status": "processing",
                "created_at": "2026-01-01T00:00:00+00:00",
                "finished_at": None,
                "duration_ms": None,
                "error": None,
                "markdown_length": 0,
            }
        ),
        encoding="utf-8",
    )
    manager = TaskManager(data_dir=tmp_path, max_workers=1)
    deadline = time.time() + 60
    while time.time() < deadline:
        meta = manager.get_task("abc123")
        if meta and meta["status"] in ("completed", "failed"):
            break
        time.sleep(0.2)
    assert meta is not None and meta["status"] == "completed", meta


def test_health_reports_both_engines() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["engines"]["markitdown"] is True
    assert body["engines"]["docling"] is True


def test_convert_docx_edit_retry_and_zip_export() -> None:
    resp = client.post(
        "/api/convert",
        files={"file": ("report.docx", _make_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"engine": "auto"},
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    result = _wait_task(task_id)
    assert result["status"] == "completed", result.get("error")
    assert result["engine_used"] == "markitdown"
    assert isinstance(result["duration_ms"], int)
    assert result["file_size"] > 0
    assert "Project Report" in result["markdown"]

    # Edit markdown and verify persistence
    edited_md = result["markdown"] + "\n\n## Edited Section\nUpdated in v1 editor.\n"
    upd = client.put(f"/api/tasks/{task_id}/markdown", json={"markdown": edited_md})
    assert upd.status_code == 200
    assert "Edited Section" in upd.json()["markdown"]

    # ZIP export includes edited markdown
    zip_resp = client.get(f"/api/tasks/export-zip?ids={task_id}")
    assert zip_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        assert "report.md" in zf.namelist()
        assert "Updated in v1 editor." in zf.read("report.md").decode("utf-8")

    # Retry task
    retry_resp = client.post(f"/api/tasks/{task_id}/retry", json={"engine": "markitdown"})
    assert retry_resp.status_code == 202
    retried = _wait_task(task_id)
    assert retried["status"] == "completed"
    assert "Project Report" in retried["markdown"]

    assert client.delete(f"/api/tasks/{task_id}").status_code == 200


def test_convert_xlsx_with_markitdown() -> None:
    resp = client.post(
        "/api/convert",
        files={"file": ("budget.xlsx", _make_xlsx_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"engine": "markitdown"},
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    result = _wait_task(task_id)
    assert result["status"] == "completed", result.get("error")
    assert result["engine_used"] == "markitdown"
    assert "Server" in result["markdown"]
    assert "120" in result["markdown"]

    assert client.delete(f"/api/tasks/{task_id}").status_code == 200


def test_convert_pdf_with_docling() -> None:
    resp = client.post(
        "/api/convert",
        files={"file": ("paper.pdf", _make_pdf_bytes(), "application/pdf")},
        data={"engine": "docling"},
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    result = _wait_task(task_id)
    assert result["status"] == "completed", result.get("error")
    assert result["engine_used"] == "docling"
    assert "Academic Paper Sample" in result["markdown"]

    src_resp = client.get(f"/api/tasks/{task_id}/source")
    assert src_resp.status_code == 200
    assert src_resp.headers["content-type"].startswith("application/pdf")
    assert src_resp.content.startswith(b"%PDF")

    assert client.delete(f"/api/tasks/{task_id}").status_code == 200
