from __future__ import annotations

import hmac
import mimetypes
import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app.converter import EngineChoice, check_engines
from app.tasks import TaskManager

APP_VERSION = "0.3.0"
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
MAX_WORKERS = int(os.getenv("MAX_WORKERS", "2"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "200"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".html",
    ".htm",
    ".csv",
    ".json",
    ".xml",
    ".txt",
    ".md",
    ".epub",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".tif",
    ".tiff",
    ".bmp",
}

app = FastAPI(title="MarkItDown Multi-Platform Converter API", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

task_manager = TaskManager(data_dir=DATA_DIR, max_workers=MAX_WORKERS)


class UpdateMarkdownPayload(BaseModel):
    markdown: str


class RetryPayload(BaseModel):
    engine: EngineChoice | None = None


class RenamePayload(BaseModel):
    filename: str | None = Field(default=None, min_length=1, max_length=255)
    pinned: bool | None = None


class ConvertTextPayload(BaseModel):
    title: str = Field(default="剪贴板文稿", min_length=1, max_length=200)
    content: str = Field(min_length=1)
    format: str = Field(default="html", pattern="^(html|txt|csv|json|xml|md)$")
    engine: EngineChoice = "markitdown"


class BatchDeletePayload(BaseModel):
    task_ids: list[str] = Field(min_length=1)


def verify_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("API_TOKEN", "").strip()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    provided = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=403, detail="Invalid API token")


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "engines": check_engines(),
        "auth_required": bool(os.getenv("API_TOKEN", "").strip()),
        "max_upload_mb": MAX_UPLOAD_MB,
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
    }


@app.post("/api/convert", status_code=202, dependencies=[Depends(verify_token)])
async def create_conversion(
    file: UploadFile = File(...),
    engine: EngineChoice = Form("auto"),
) -> dict:
    filename = Path(file.filename or "document.bin").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {suffix or 'unknown'}")

    limit = MAX_UPLOAD_MB * 1024 * 1024
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_MB} MB limit")
        chunks.append(chunk)
    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    return task_manager.create_task(filename=filename, content=content, engine=engine)


@app.post("/api/convert-text", status_code=202, dependencies=[Depends(verify_token)])
def create_text_conversion(payload: ConvertTextPayload) -> dict:
    raw = payload.content.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Content is empty")
    safe_stem = Path(payload.title.strip()).stem or "snippet"
    ext = f".{payload.format.lower()}"
    if payload.format == "html" and "<html" not in raw.lower():
        wrapped = f"<!doctype html><html><head><meta charset='utf-8'><title>{safe_stem}</title></head><body>{raw}</body></html>"
        content_bytes = wrapped.encode("utf-8")
    else:
        content_bytes = raw.encode("utf-8")
    return task_manager.create_task(
        filename=f"{safe_stem}{ext}",
        content=content_bytes,
        engine=payload.engine,
    )


@app.post("/api/tasks/batch-delete", dependencies=[Depends(verify_token)])
def batch_delete_tasks(payload: BatchDeletePayload) -> dict:
    deleted: list[str] = []
    for tid in payload.task_ids:
        if task_manager.delete_task(tid):
            deleted.append(tid)
    return {"deleted": deleted}


@app.get("/api/tasks", dependencies=[Depends(verify_token)])
def list_tasks() -> dict:
    return {"tasks": task_manager.list_tasks()}


@app.get("/api/tasks/export-zip", dependencies=[Depends(verify_token)])
def export_tasks_zip(ids: str | None = Query(default=None)) -> Response:
    task_ids = [item.strip() for item in ids.split(",") if item.strip()] if ids else None
    payload = task_manager.build_export_zip(task_ids=task_ids)
    if payload is None:
        raise HTTPException(status_code=404, detail="No completed tasks available for export")
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="markitdown-export.zip"'},
    )


@app.get("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
def get_task(task_id: str) -> dict:
    task = task_manager.get_task(task_id, include_markdown=True)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.put("/api/tasks/{task_id}/markdown", dependencies=[Depends(verify_token)])
def update_task_markdown(task_id: str, payload: UpdateMarkdownPayload) -> dict:
    updated = task_manager.update_markdown(task_id, payload.markdown)
    if updated is None:
        raise HTTPException(status_code=404, detail="Completed task not found")
    return updated


@app.post("/api/tasks/{task_id}/retry", status_code=202, dependencies=[Depends(verify_token)])
def retry_task(task_id: str, payload: RetryPayload | None = None) -> dict:
    engine = payload.engine if payload else None
    retried = task_manager.retry_task(task_id, engine=engine)
    if retried is None:
        raise HTTPException(status_code=404, detail="Task or source file not found")
    return retried


@app.get("/api/tasks/{task_id}/download", dependencies=[Depends(verify_token)])
def download_task(task_id: str) -> FileResponse:
    found = task_manager.get_result_file(task_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Converted file not ready or not found")
    path, download_name = found
    return FileResponse(path=path, media_type="text/markdown; charset=utf-8", filename=download_name)


@app.get("/api/tasks/{task_id}/source", dependencies=[Depends(verify_token)])
def get_task_source(task_id: str) -> FileResponse:
    found = task_manager.get_source_file(task_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Source file not found")
    path, original_name = found
    mime_type, _ = mimetypes.guess_type(original_name)
    return FileResponse(
        path=path,
        media_type=mime_type or "application/octet-stream",
        content_disposition_type="inline",
    )


@app.patch("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
def update_task_meta(task_id: str, payload: RenamePayload) -> dict:
    name: str | None = None
    if payload.filename is not None:
        name = Path(payload.filename.strip()).name
        if not name:
            raise HTTPException(status_code=400, detail="Invalid filename")
    updated = task_manager.update_task_meta(task_id, filename=name, pinned=payload.pinned)
    if updated is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return updated


@app.delete("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
def delete_task(task_id: str) -> dict:
    if not task_manager.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"deleted": task_id}
