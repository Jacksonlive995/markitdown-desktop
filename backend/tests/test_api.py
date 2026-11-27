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


def _make_png_bytes() -> bytes:
    from PIL import Image

    img = Image.new("RGB", (64, 48), color=(30, 120, 220))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_docx_with_image_bytes() -> bytes:
    from docx.shared import Inches

    doc = Document()
    doc.add_heading("Visual Architecture Report", level=1)
    doc.add_paragraph("UniqueSearchTokenAlpha99 appears inside body content.")
    img_buf = io.BytesIO(_make_png_bytes())
    doc.add_picture(img_buf, width=Inches(1.2))
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Metric"
    table.cell(0, 1).text = "Value"
    table.cell(1, 0).text = "Accuracy"
    table.cell(1, 1).text = "99.1%"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_assets_extraction_frontmatter_search_preview_and_vault_export(tmp_path) -> None:
    resp = client.post(
        "/api/convert",
        files={
            "file": (
                "visual_report.docx",
                _make_docx_with_image_bytes(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={
            "engine": "markitdown",
            "extract_images": "true",
            "frontmatter": "true",
        },
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]
    result = _wait_task(task_id)
    assert result["status"] == "completed", result.get("error")
    assert result["progress_pct"] == 100
    assert result["markdown"].startswith("---\n")
    assert "assets/fig_01." in result["markdown"]
    assert len(result["assets"]) >= 1

    asset_name = result["assets"][0]
    asset_resp = client.get(f"/api/tasks/{task_id}/assets/{asset_name}")
    assert asset_resp.status_code == 200
    assert asset_resp.headers["content-type"].startswith("image/")

    # ZIP export should include both md and extracted assets
    zip_resp = client.get(f"/api/tasks/export-zip?ids={task_id}")
    assert zip_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        names = zf.namelist()
        assert "visual_report.md" in names
        assert f"assets/{asset_name}" in names

    # Full-text search hits body content and returns snippet
    search_resp = client.get("/api/tasks", params={"q": "UniqueSearchTokenAlpha99"})
    assert search_resp.status_code == 200
    hits = search_resp.json()["tasks"]
    assert any(h["task_id"] == task_id for h in hits)
    hit = next(h for h in hits if h["task_id"] == task_id)
    assert hit["match_source"] == "content"
    assert "UniqueSearchTokenAlpha99" in hit["match_snippet"]

    # DOCX source preview returns structured HTML
    preview_resp = client.get(f"/api/tasks/{task_id}/source-preview")
    assert preview_resp.status_code == 200
    preview = preview_resp.json()
    assert preview["kind"] == "docx"
    assert "Visual Architecture Report" in preview["html"]
    assert "<table>" in preview["html"]

    # Export to local Obsidian vault folder
    vault_dir = tmp_path / "MyVault"
    vault_dir.mkdir()
    vault_resp = client.post(
        f"/api/tasks/{task_id}/export-to-vault",
        json={
            "vault_path": str(vault_dir),
            "subfolder": "Inbox",
            "include_frontmatter": True,
        },
    )
    assert vault_resp.status_code == 200, vault_resp.text
    vault_data = vault_resp.json()
    assert vault_data["assets_copied"] >= 1
    written_md = (vault_dir / "Inbox" / "visual_report.md").read_text(encoding="utf-8")
    assert f"assets/visual_report/{asset_name}" in written_md
    assert (vault_dir / "Inbox" / "assets" / "visual_report" / asset_name).exists()

    assert client.delete(f"/api/tasks/{task_id}").status_code == 200


def test_xlsx_source_preview_and_dual_engine_snapshots() -> None:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Summary"
    ws1.append(["Quarter", "Revenue"])
    ws1.append(["Q1", 500])
    ws2 = wb.create_sheet("Details")
    ws2.append(["Region", "Sales"])
    ws2.append(["APAC", 320])
    buf = io.BytesIO()
    wb.save(buf)

    resp = client.post(
        "/api/convert",
        files={
            "file": (
                "quarterly.xlsx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"engine": "markitdown"},
    )
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]
    result = _wait_task(task_id)
    assert result["status"] == "completed"
    assert "markitdown" in result.get("engine_snapshots", [])
    assert "markitdown" in result.get("engine_results", {})

    preview_resp = client.get(f"/api/tasks/{task_id}/source-preview")
    assert preview_resp.status_code == 200
    preview = preview_resp.json()
    assert preview["kind"] == "xlsx"
    assert len(preview["sheets"]) == 2
    assert preview["sheets"][0]["name"] == "Summary"
    assert preview["sheets"][1]["name"] == "Details"

    assert client.delete(f"/api/tasks/{task_id}").status_code == 200


def test_convert_url_with_local_http_server() -> None:
    import http.server
    import threading

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"<html><head><title>Local Test Article</title></head><body><h1>URL Heading</h1><p>Hello from URL fetch.</p></body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        resp = client.post(
            "/api/convert-url",
            json={
                "url": f"http://127.0.0.1:{port}/article",
                "engine": "markitdown",
                "frontmatter": True,
            },
        )
        assert resp.status_code == 202, resp.text
        task_id = resp.json()["task_id"]
        result = _wait_task(task_id)
        assert result["status"] == "completed", result.get("error")
        assert "Local Test Article" in result["filename"]
        assert "Hello from URL fetch." in result["markdown"]
        assert result["source_url"] == f"http://127.0.0.1:{port}/article"
        assert client.delete(f"/api/tasks/{task_id}").status_code == 200
    finally:
        server.shutdown()


def test_vlm_asset_analysis_and_task_cancel(monkeypatch) -> None:
    import app.vlm as vlm_mod

    def _fake_describe(image_path, cfg, custom_prompt=None, timeout=60.0):
        return f"架构图解读（模型 {cfg.model}）：包含三个核心服务模块。"

    monkeypatch.setattr(vlm_mod, "describe_image", _fake_describe)
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "describe_image", _fake_describe)

    resp = client.post(
        "/api/convert",
        files={
            "file": (
                "diagram.docx",
                _make_docx_with_image_bytes(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={"engine": "markitdown", "extract_images": "true"},
    )
    task_id = resp.json()["task_id"]
    result = _wait_task(task_id)
    assert result["status"] == "completed"
    asset_name = result["assets"][0]

    an_resp = client.post(
        f"/api/tasks/{task_id}/assets/{asset_name}/analyze",
        json={
            "vlm_config": {
                "enabled": True,
                "base_url": "https://api.example.com/v1",
                "api_key": "sk-test",
                "model": "gpt-4o-mini",
            }
        },
    )
    assert an_resp.status_code == 200, an_resp.text
    assert "架构图解读" in an_resp.json()["description"]

    # Cancel endpoint on completed task returns cleanly without error
    cancel_resp = client.post(f"/api/tasks/{task_id}/cancel")
    assert cancel_resp.status_code == 200

    assert client.delete(f"/api/tasks/{task_id}").status_code == 200
