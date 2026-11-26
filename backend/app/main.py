from __future__ import annotations

import mimetypes
import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.converter import EngineChoice, check_engines
from app.tasks import TaskManager

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
MAX_WORKERS = int(os.getenv("MAX_WORKERS", "2"))

app = FastAPI(title="MarkItDown Multi-Platform Converter API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

task_manager = TaskManager(data_dir=DATA_DIR, max_workers=MAX_WORKERS)


class UpdateMarkdownPayload(BaseModel):
    markdown: str


class RetryPayload(BaseModel):
    engine: EngineChoice | None = None


def verify_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("API_TOKEN", "").strip()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    provided = authorization.removeprefix("Bearer ").strip()
    if provided != expected:
        raise HTTPException(status_code=403, detail="Invalid API token")


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "engines": check_engines(),
        "auth_required": bool(os.getenv("API_TOKEN", "").strip()),
    }


@app.post("/api/convert", status_code=202, dependencies=[Depends(verify_token)])
async def create_conversion(
    file: UploadFile = File(...),
    engine: EngineChoice = Form("auto"),
) -> dict:
    filename = file.filename or "document.bin"
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    return task_manager.create_task(filename=filename, content=content, engine=engine)


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


@app.delete("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
def delete_task(task_id: str) -> dict:
    if not task_manager.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"deleted": task_id}
