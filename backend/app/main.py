from __future__ import annotations

import asyncio
import hmac
import json
import mimetypes
import os
import queue
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from app.converter import ConversionOptions, EngineChoice, OcrModeChoice, check_engines
from app.source_preview import build_source_preview
from app.tasks import TaskManager
from app.vlm import VlmConfig, describe_image, test_vlm_connection

APP_VERSION = "3.0.0"
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

CONTENT_TYPE_EXT_MAP = {
    "application/pdf": ".pdf",
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    "text/markdown": ".md",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
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


class VlmPayload(BaseModel):
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    prompt: str = ""


class UpdateMarkdownPayload(BaseModel):
    markdown: str


class RetryPayload(BaseModel):
    engine: EngineChoice | None = None
    page_range: str | None = None
    ocr_mode: OcrModeChoice | None = None
    extract_images: bool | None = None
    use_vlm: bool | None = None
    frontmatter: bool | None = None
    vlm_config: VlmPayload | None = None


class RenamePayload(BaseModel):
    filename: str | None = Field(default=None, min_length=1, max_length=255)
    pinned: bool | None = None


class ConvertTextPayload(BaseModel):
    title: str = Field(default="剪贴板文稿", min_length=1, max_length=200)
    content: str = Field(min_length=1)
    format: str = Field(default="html", pattern="^(html|txt|csv|json|xml|md)$")
    engine: EngineChoice = "markitdown"
    frontmatter: bool = False


class ConvertUrlPayload(BaseModel):
    url: str = Field(min_length=4, max_length=2048)
    engine: EngineChoice = "auto"
    page_range: str = ""
    ocr_mode: OcrModeChoice = "auto"
    extract_images: bool = True
    use_vlm: bool = False
    frontmatter: bool = False
    vlm_config: VlmPayload | None = None


class BatchDeletePayload(BaseModel):
    task_ids: list[str] = Field(min_length=1)


class AnalyzeAssetPayload(BaseModel):
    vlm_config: VlmPayload | None = None
    prompt: str | None = None


class ExportVaultPayload(BaseModel):
    vault_path: str = Field(min_length=1, max_length=1024)
    subfolder: str = Field(default="MarkItDown", max_length=256)
    include_frontmatter: bool = True
    markdown: str | None = None


def _check_token_value(provided: str | None) -> None:
    expected = os.getenv("API_TOKEN", "").strip()
    if not expected:
        return
    if not provided:
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    if not hmac.compare_digest(provided.strip().encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=403, detail="Invalid API token")


def verify_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("API_TOKEN", "").strip()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    _check_token_value(authorization.removeprefix("Bearer "))


def verify_token_or_query(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> None:
    expected = os.getenv("API_TOKEN", "").strip()
    if not expected:
        return
    if authorization and authorization.startswith("Bearer "):
        _check_token_value(authorization.removeprefix("Bearer "))
        return
    if token:
        _check_token_value(token)
        return
    raise HTTPException(status_code=401, detail="Missing Bearer token")


def _parse_bool_form(val: str | bool | None, default: bool) -> bool:
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    return val.strip().lower() in ("1", "true", "yes", "on")


def _parse_vlm_json(raw: str | None) -> VlmConfig:
    if not raw or not raw.strip():
        return VlmConfig.from_dict_or_env()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return VlmConfig.from_dict_or_env(parsed)
    except ValueError:
        pass
    return VlmConfig.from_dict_or_env()


@app.get("/api/health")
def health() -> dict:
    env_vlm = VlmConfig.from_dict_or_env()
    return {
        "status": "ok",
        "version": APP_VERSION,
        "engines": check_engines(),
        "auth_required": bool(os.getenv("API_TOKEN", "").strip()),
        "max_upload_mb": MAX_UPLOAD_MB,
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
        "vlm_configured": env_vlm.is_ready(),
        "features": ["assets", "vlm", "url", "sse", "office_preview", "vault_export", "cancel"],
    }


@app.post("/api/vlm/test", dependencies=[Depends(verify_token)])
def test_vlm_endpoint(payload: VlmPayload) -> dict:
    cfg = VlmConfig.from_dict_or_env(payload.model_dump())
    try:
        return test_vlm_connection(cfg)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"VLM 连接测试失败: {exc}") from exc


@app.post("/api/convert", status_code=202, dependencies=[Depends(verify_token)])
async def create_conversion(
    file: UploadFile = File(...),
    engine: EngineChoice = Form("auto"),
    page_range: str = Form(""),
    ocr_mode: OcrModeChoice = Form("auto"),
    extract_images: str = Form("true"),
    use_vlm: str = Form("false"),
    frontmatter: str = Form("false"),
    vlm_config: str | None = Form(None),
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

    vlm_cfg = _parse_vlm_json(vlm_config)
    opts = ConversionOptions(
        page_range=page_range.strip(),
        ocr_mode=ocr_mode,
        extract_images=_parse_bool_form(extract_images, True),
        use_vlm=_parse_bool_form(use_vlm, False),
        frontmatter=_parse_bool_form(frontmatter, False),
        vlm=vlm_cfg,
    )
    return task_manager.create_task(filename=filename, content=content, engine=engine, options=opts)


@app.post("/api/convert-text", status_code=202, dependencies=[Depends(verify_token)])
def create_text_conversion(payload: ConvertTextPayload) -> dict:
    raw = payload.content.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Content is empty")
    safe_stem = Path(payload.title.strip()).stem or "snippet"
    ext = f".{payload.format.lower()}"
    if payload.format == "html" and "<html" not in raw.lower():
        wrapped = (
            f"<!doctype html><html><head><meta charset='utf-8'><title>{safe_stem}</title>"
            f"</head><body>{raw}</body></html>"
        )
        content_bytes = wrapped.encode("utf-8")
    else:
        content_bytes = raw.encode("utf-8")
    opts = ConversionOptions(extract_images=False, frontmatter=payload.frontmatter)
    return task_manager.create_task(
        filename=f"{safe_stem}{ext}",
        content=content_bytes,
        engine=payload.engine,
        options=opts,
    )


def _derive_url_filename(url: str, content_type: str, content_disposition: str, body: bytes) -> str:
    # 1. Try Content-Disposition header
    if content_disposition:
        m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', content_disposition, re.IGNORECASE)
        if m:
            candidate = Path(unquote(m.group(1)).strip()).name
            if Path(candidate).suffix.lower() in ALLOWED_EXTENSIONS:
                return candidate

    parsed = urlparse(url)
    url_name = Path(unquote(parsed.path)).name
    ct_base = content_type.split(";")[0].strip().lower()
    ext = Path(url_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        ext = CONTENT_TYPE_EXT_MAP.get(ct_base, ".html")

    # 2. If HTML, try extracting <title> for readable filename
    stem = Path(url_name).stem if url_name and url_name not in ("/", "") else ""
    if ext == ".html":
        try:
            head_text = body[:16384].decode("utf-8", errors="ignore")
            tm = re.search(r"<title[^>]*>(.*?)</title>", head_text, re.IGNORECASE | re.DOTALL)
            if tm:
                title_clean = re.sub(r"\s+", " ", tm.group(1)).strip()
                title_clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", title_clean)[:80].strip(" .")
                if title_clean:
                    stem = title_clean
        except Exception:
            pass

    if not stem:
        stem = (parsed.netloc or "webpage").replace(":", "_")
    return f"{stem}{ext}"


@app.post("/api/convert-url", status_code=202, dependencies=[Depends(verify_token)])
async def create_url_conversion(payload: ConvertUrlPayload) -> dict:
    url = payload.url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="请输入有效的 http:// 或 https:// URL 地址")

    limit = MAX_UPLOAD_MB * 1024 * 1024
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=30.0,
            headers={"User-Agent": "MarkItDown-Desktop/3.0 (+https://github.com/microsoft/markitdown)"},
        ) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "")
                content_disposition = resp.headers.get("content-disposition", "")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes(chunk_size=256 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(
                            status_code=413, detail=f"远程资源超过 {MAX_UPLOAD_MB} MB 上限"
                        )
                    chunks.append(chunk)
                content = b"".join(chunks)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"抓取远程 URL 失败: {exc}") from exc

    if not content:
        raise HTTPException(status_code=400, detail="远程 URL 返回内容为空")

    filename = _derive_url_filename(url, content_type, content_disposition, content)
    vlm_cfg = VlmConfig.from_dict_or_env(payload.vlm_config.model_dump() if payload.vlm_config else None)
    opts = ConversionOptions(
        page_range=payload.page_range.strip(),
        ocr_mode=payload.ocr_mode,
        extract_images=payload.extract_images,
        use_vlm=payload.use_vlm,
        frontmatter=payload.frontmatter,
        vlm=vlm_cfg,
    )
    return task_manager.create_task(
        filename=filename,
        content=content,
        engine=payload.engine,
        options=opts,
        source_url=url,
    )


@app.post("/api/tasks/batch-delete", dependencies=[Depends(verify_token)])
def batch_delete_tasks(payload: BatchDeletePayload) -> dict:
    deleted: list[str] = []
    for tid in payload.task_ids:
        if task_manager.delete_task(tid):
            deleted.append(tid)
    return {"deleted": deleted}


@app.get("/api/tasks", dependencies=[Depends(verify_token)])
def list_tasks(q: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500)) -> dict:
    return {"tasks": task_manager.list_tasks(limit=limit, q=q)}


@app.get("/api/tasks/events", dependencies=[Depends(verify_token_or_query)])
async def stream_task_events(request: Request) -> StreamingResponse:
    sub_queue = task_manager.subscribe()

    async def _event_generator():
        try:
            yield f"data: {json.dumps({'type': 'connected'}, ensure_ascii=False)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.to_thread(sub_queue.get, True, 15.0)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            task_manager.unsubscribe(sub_queue)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
    opts: ConversionOptions | None = None
    if payload and any(
        v is not None
        for v in (
            payload.page_range,
            payload.ocr_mode,
            payload.extract_images,
            payload.use_vlm,
            payload.frontmatter,
            payload.vlm_config,
        )
    ):
        vlm_cfg = VlmConfig.from_dict_or_env(
            payload.vlm_config.model_dump() if payload.vlm_config else None
        )
        opts = ConversionOptions(
            page_range=(payload.page_range or "").strip(),
            ocr_mode=payload.ocr_mode or "auto",
            extract_images=True if payload.extract_images is None else payload.extract_images,
            use_vlm=False if payload.use_vlm is None else payload.use_vlm,
            frontmatter=False if payload.frontmatter is None else payload.frontmatter,
            vlm=vlm_cfg,
        )
    retried = task_manager.retry_task(task_id, engine=engine, options=opts)
    if retried is None:
        raise HTTPException(status_code=404, detail="Task or source file not found")
    return retried


@app.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(verify_token)])
def cancel_task(task_id: str) -> dict:
    cancelled = task_manager.cancel_task(task_id)
    if cancelled is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return cancelled


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


@app.get("/api/tasks/{task_id}/source-preview", dependencies=[Depends(verify_token)])
def get_task_source_preview(task_id: str) -> dict:
    found = task_manager.get_source_file(task_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Source file not found")
    path, original_name = found
    try:
        return build_source_preview(path, original_name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"生成原文件预览失败: {exc}") from exc


@app.get("/api/tasks/{task_id}/assets/{filename}", dependencies=[Depends(verify_token_or_query)])
def get_task_asset(task_id: str, filename: str) -> FileResponse:
    asset_path = task_manager.get_asset_file(task_id, filename)
    if asset_path is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    mime_type, _ = mimetypes.guess_type(asset_path.name)
    return FileResponse(
        path=asset_path,
        media_type=mime_type or "application/octet-stream",
        content_disposition_type="inline",
    )


@app.post("/api/tasks/{task_id}/assets/{filename}/analyze", dependencies=[Depends(verify_token)])
def analyze_task_asset(task_id: str, filename: str, payload: AnalyzeAssetPayload | None = None) -> dict:
    asset_path = task_manager.get_asset_file(task_id, filename)
    if asset_path is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    raw_cfg = payload.vlm_config.model_dump() if (payload and payload.vlm_config) else None
    cfg = VlmConfig.from_dict_or_env(raw_cfg)
    if not cfg.base_url or not cfg.model:
        raise HTTPException(status_code=400, detail="请先在设置中配置 VLM Base URL 和模型名称")
    try:
        description = describe_image(asset_path, cfg, custom_prompt=payload.prompt if payload else None)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"VLM 视觉解读失败: {exc}") from exc
    return {"filename": asset_path.name, "model": cfg.model, "description": description}


@app.post("/api/tasks/{task_id}/export-to-vault", dependencies=[Depends(verify_token)])
def export_task_to_vault(task_id: str, payload: ExportVaultPayload) -> dict:
    try:
        return task_manager.export_to_vault(
            task_id,
            payload.vault_path,
            subfolder=payload.subfolder,
            include_frontmatter=payload.include_frontmatter,
            markdown_override=payload.markdown,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入知识库目录失败: {exc}") from exc


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
