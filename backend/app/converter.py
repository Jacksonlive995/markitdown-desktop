from __future__ import annotations

import base64
import importlib.util
import re
import shutil
import threading
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from app.vlm import OpenAICompatibleClient, VlmConfig, enrich_markdown_assets

EngineChoice = Literal["auto", "markitdown", "docling"]
OcrModeChoice = Literal["auto", "force_full_page", "off"]

DOCLING_PREFERRED_EXTS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
    ".webp",
}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}

_docling_lock = threading.Lock()
_docling_converters: dict[tuple[str, bool], Any] = {}
_markitdown_instance = None


class TaskCancelledError(Exception):
    """Raised when a conversion task is cancelled by the user."""


@dataclass
class ConversionOptions:
    page_range: str = ""
    ocr_mode: OcrModeChoice = "auto"
    extract_images: bool = True
    use_vlm: bool = False
    frontmatter: bool = False
    vlm: VlmConfig = field(default_factory=VlmConfig)

    def to_meta_dict(self) -> dict[str, Any]:
        return {
            "page_range": self.page_range,
            "ocr_mode": self.ocr_mode,
            "extract_images": self.extract_images,
            "use_vlm": self.use_vlm,
            "frontmatter": self.frontmatter,
        }


def check_engines() -> dict[str, bool]:
    return {
        "markitdown": importlib.util.find_spec("markitdown") is not None,
        "docling": importlib.util.find_spec("docling") is not None,
    }


def resolve_engine(file_path: Path, engine: EngineChoice) -> Literal["markitdown", "docling"]:
    available = check_engines()

    if engine == "markitdown":
        if not available["markitdown"]:
            raise RuntimeError("MarkItDown engine is not installed on the server.")
        return "markitdown"

    if engine == "docling":
        if not available["docling"]:
            raise RuntimeError("Docling engine is not installed on the server.")
        return "docling"

    ext = file_path.suffix.lower()
    if ext in DOCLING_PREFERRED_EXTS and available["docling"]:
        return "docling"
    if available["markitdown"]:
        return "markitdown"
    if available["docling"]:
        return "docling"
    raise RuntimeError("No conversion engine is installed on the server.")


def parse_page_range(spec: str) -> tuple[int, int] | None:
    """Parse user page range like '1-5' or '2, 4-8' into Docling's (start, end) 1-based bounds."""
    cleaned = (spec or "").strip()
    if not cleaned:
        return None
    pages: list[int] = []
    for part in cleaned.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            pieces = token.split("-", 1)
            try:
                start = int(pieces[0].strip())
                end = int(pieces[1].strip())
                if start >= 1 and end >= start:
                    pages.extend([start, end])
            except ValueError:
                continue
        else:
            try:
                p = int(token)
                if p >= 1:
                    pages.append(p)
            except ValueError:
                continue
    if not pages:
        return None
    return (min(pages), max(pages))


def _get_markitdown(vlm: VlmConfig | None = None):
    global _markitdown_instance
    from markitdown import MarkItDown

    if vlm and vlm.is_ready():
        return MarkItDown(
            llm_client=OpenAICompatibleClient(vlm),
            llm_model=vlm.model,
            llm_prompt=vlm.prompt,
        )
    if _markitdown_instance is None:
        _markitdown_instance = MarkItDown()
    return _markitdown_instance


def _get_docling(ocr_mode: OcrModeChoice = "auto", extract_images: bool = True):
    cache_key = (ocr_mode, extract_images)
    if cache_key in _docling_converters:
        return _docling_converters[cache_key]

    with _docling_lock:
        if cache_key in _docling_converters:
            return _docling_converters[cache_key]

        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import OcrAutoOptions, OcrMode, PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        pipeline_options = PdfPipelineOptions()
        pipeline_options.generate_picture_images = extract_images
        pipeline_options.images_scale = 2.0

        if ocr_mode == "off":
            pipeline_options.do_ocr = False
        elif ocr_mode == "force_full_page":
            pipeline_options.do_ocr = True
            pipeline_options.ocr_options = OcrAutoOptions(mode=OcrMode.FULL_PAGE)
        else:
            pipeline_options.do_ocr = True
            pipeline_options.ocr_options = OcrAutoOptions(mode=OcrMode.DEFAULT)

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            }
        )
        _docling_converters[cache_key] = converter
        return converter


DATA_URI_IMG_RE = re.compile(
    r"!\[([^\]]*)\]\(data:image/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\)"
)


def _extract_data_uri_images(markdown: str, assets_dir: Path, start_index: int = 1) -> tuple[str, list[str]]:
    assets_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    counter = start_index

    def _replace(match: re.Match[str]) -> str:
        nonlocal counter
        alt = match.group(1) or f"Figure {counter}"
        fmt = match.group(2).lower().split("+")[0]
        ext = "jpg" if fmt == "jpeg" else fmt
        raw_b64 = re.sub(r"\s+", "", match.group(3))
        try:
            data = base64.b64decode(raw_b64)
        except Exception:
            return match.group(0)
        filename = f"fig_{counter:02d}.{ext}"
        counter += 1
        (assets_dir / filename).write_bytes(data)
        saved.append(filename)
        return f"![{alt}](assets/{filename})"

    rewritten = DATA_URI_IMG_RE.sub(_replace, markdown)
    return rewritten, saved


def _extract_openxml_media(file_path: Path, assets_dir: Path, start_index: int = 1) -> list[str]:
    """Extract embedded images from .docx / .pptx / .xlsx OpenXML zip packages."""
    ext = file_path.suffix.lower()
    if ext not in (".docx", ".pptx", ".xlsx"):
        return []
    saved: list[str] = []
    counter = start_index
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            media_entries = sorted(
                name
                for name in zf.namelist()
                if ("/media/" in name.lower() or name.lower().startswith("media/"))
                and Path(name).suffix.lower() in IMAGE_EXTS
            )
            if not media_entries:
                return []
            assets_dir.mkdir(parents=True, exist_ok=True)
            for entry in media_entries:
                img_ext = Path(entry).suffix.lower()
                if img_ext == ".jpeg":
                    img_ext = ".jpg"
                out_name = f"fig_{counter:02d}{img_ext}"
                counter += 1
                (assets_dir / out_name).write_bytes(zf.read(entry))
                saved.append(out_name)
    except (zipfile.BadZipFile, OSError):
        return []
    return saved


def _build_frontmatter(
    *,
    filename: str,
    engine_used: str,
    assets_count: int,
    source_url: str | None = None,
) -> str:
    stem = Path(filename).stem or filename
    safe_title = stem.replace('"', '\\"')
    safe_source = (source_url or filename).replace('"', '\\"')
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "---",
        f'title: "{safe_title}"',
        f'source: "{safe_source}"',
        f"created_at: {created}",
        f"engine: {engine_used}",
        f"assets_count: {assets_count}",
        "tags:",
        "  - markitdown",
        f"  - {engine_used}",
        "---",
        "",
    ]
    return "\n".join(lines)


def _normalize_docling_assets(
    markdown: str,
    assets_dir: Path,
) -> tuple[str, list[str]]:
    """Normalize Docling referenced image links to clean `assets/fig_XX.png` relative paths."""
    if not assets_dir.exists():
        return markdown, []

    # Collect generated image files in assets_dir
    files = sorted(
        p for p in assets_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )
    if not files:
        return markdown, []

    rename_map: dict[str, str] = {}
    final_names: list[str] = []
    for idx, p in enumerate(files, start=1):
        ext = p.suffix.lower()
        new_name = f"fig_{idx:02d}{ext}"
        target = assets_dir / new_name
        if p.name != new_name:
            if target.exists():
                target.unlink()
            p.rename(target)
        rename_map[p.name] = new_name
        final_names.append(new_name)

    def _rewrite_link(match: re.Match[str]) -> str:
        alt = match.group(1) or "Figure"
        raw_path = match.group(2).replace("\\", "/")
        base = Path(raw_path).name
        if base in rename_map:
            return f"![{alt}](assets/{rename_map[base]})"
        if base in final_names:
            return f"![{alt}](assets/{base})"
        return match.group(0)

    rewritten = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", _rewrite_link, markdown)
    return rewritten, final_names


def convert_file(
    file_path: Path,
    engine: EngineChoice = "auto",
    *,
    options: ConversionOptions | None = None,
    assets_dir: Path | None = None,
    source_filename: str | None = None,
    source_url: str | None = None,
    progress_cb: Callable[[int, str], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> tuple[str, str, list[str]]:
    opts = options or ConversionOptions()
    display_name = source_filename or file_path.name

    def _check_cancel() -> None:
        if cancel_event and cancel_event.is_set():
            raise TaskCancelledError("任务已被用户取消")

    def _report(pct: int, stage: str) -> None:
        if progress_cb:
            progress_cb(max(0, min(100, pct)), stage)

    _check_cancel()
    chosen = resolve_engine(file_path, engine)
    _report(10, f"正在初始化 {chosen} 引擎")

    # Clean previous assets dir before a fresh conversion
    if assets_dir is not None:
        if assets_dir.exists():
            shutil.rmtree(assets_dir, ignore_errors=True)
        if opts.extract_images:
            assets_dir.mkdir(parents=True, exist_ok=True)

    extracted_assets: list[str] = []

    if chosen == "markitdown":
        _check_cancel()
        _report(25, "正在使用 MarkItDown 解析文档结构")
        md_engine = _get_markitdown(opts.vlm if opts.use_vlm else None)
        result = md_engine.convert(str(file_path))
        text = result.text_content or ""

        _check_cancel()
        if opts.extract_images and assets_dir is not None:
            _report(55, "正在提取文档内嵌图片资源")
            # 1) Save any inline base64 data URIs emitted by markitdown
            text, uri_assets = _extract_data_uri_images(text, assets_dir, start_index=1)
            extracted_assets.extend(uri_assets)

            # 2) Extract OpenXML media images (.docx / .pptx / .xlsx) if none extracted yet
            if not extracted_assets and file_path.suffix.lower() in (".docx", ".pptx", ".xlsx"):
                media_assets = _extract_openxml_media(
                    file_path,
                    assets_dir,
                    start_index=len(extracted_assets) + 1,
                )
                if media_assets:
                    extracted_assets.extend(media_assets)
                    # If markdown doesn't already reference assets/, append clean figure references
                    if "](assets/" not in text:
                        gallery = "\n\n".join(
                            f"![插图 {i}](assets/{name})" for i, name in enumerate(media_assets, start=1)
                        )
                        text = f"{text.rstrip()}\n\n## 文档插图\n\n{gallery}\n"

            # 3) If standalone image file converted via markitdown, preserve a copy in assets/
            if file_path.suffix.lower() in IMAGE_EXTS and not extracted_assets:
                assets_dir.mkdir(parents=True, exist_ok=True)
                out_name = f"fig_01{file_path.suffix.lower()}"
                shutil.copy2(file_path, assets_dir / out_name)
                extracted_assets.append(out_name)
                if f"assets/{out_name}" not in text:
                    text = f"![{display_name}](assets/{out_name})\n\n{text.strip()}".strip()
        else:
            # Strip inline base64 images in pure-text mode
            text = DATA_URI_IMG_RE.sub("", text)
    else:
        _check_cancel()
        _report(15, "正在加载 Docling 版面分析与 OCR 模型")
        converter = _get_docling(ocr_mode=opts.ocr_mode, extract_images=opts.extract_images)

        def _docling_progress(event: Any) -> None:
            _check_cancel()
            kind = getattr(event, "kind", "")
            if kind == "page_completed":
                done = getattr(event, "completed_pages", 0)
                total = getattr(event, "total_pages", 0)
                if total and total > 0:
                    pct = 20 + int((done / total) * 52)
                    _report(pct, f"正在解析第 {done}/{total} 页")
            elif kind == "phase_started":
                phase = getattr(event, "phase", "")
                _report(22, f"正在执行阶段：{phase}")
            elif kind == "enrichment":
                label = getattr(event, "label", "内容增强")
                _report(70, f"正在增强解析：{label}")

        convert_kwargs: dict[str, Any] = {"progress_callback": _docling_progress}
        parsed_range = parse_page_range(opts.page_range)
        if parsed_range is not None:
            convert_kwargs["page_range"] = parsed_range

        _report(20, "正在分析 PDF 版面与表格结构")
        result = converter.convert(str(file_path), **convert_kwargs)
        _check_cancel()

        if opts.extract_images and assets_dir is not None:
            _report(74, "正在导出 Markdown 与提取插图资源")
            from docling_core.types.doc import ImageRefMode

            assets_dir.mkdir(parents=True, exist_ok=True)
            tmp_md = assets_dir.parent / "_docling_export.md"
            try:
                result.document.save_as_markdown(
                    tmp_md,
                    artifacts_dir=assets_dir,
                    image_mode=ImageRefMode.REFERENCED,
                    image_placeholder="",
                )
                text = tmp_md.read_text(encoding="utf-8")
            finally:
                if tmp_md.exists():
                    tmp_md.unlink(missing_ok=True)
            text, extracted_assets = _normalize_docling_assets(text, assets_dir)
            # Also convert any residual data URI images if present
            text, extra_assets = _extract_data_uri_images(
                text,
                assets_dir,
                start_index=len(extracted_assets) + 1,
            )
            extracted_assets.extend(extra_assets)
        else:
            _report(74, "正在导出纯文本 Markdown")
            text = result.document.export_to_markdown(image_placeholder="")

    _check_cancel()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    # Optional VLM enrichment on extracted assets
    if opts.use_vlm and opts.vlm.is_ready() and assets_dir is not None and extracted_assets:
        _report(78, "正在调用 VLM 多模态模型解读文档插图")
        try:
            text = enrich_markdown_assets(
                text,
                assets_dir,
                opts.vlm,
                progress_cb=_report,
                cancel_event=cancel_event,
            )
        except InterruptedError as exc:
            raise TaskCancelledError(str(exc)) from exc

    # Optional YAML Frontmatter injection for Obsidian / Knowledge Base
    if opts.frontmatter and not text.startswith("---\n"):
        fm = _build_frontmatter(
            filename=display_name,
            engine_used=chosen,
            assets_count=len(extracted_assets),
            source_url=source_url,
        )
        text = f"{fm}{text}\n"

    # Remove empty assets directory if nothing extracted
    if assets_dir is not None and assets_dir.exists() and not any(assets_dir.iterdir()):
        shutil.rmtree(assets_dir, ignore_errors=True)

    _report(100, "转换完成")
    return text, chosen, extracted_assets
