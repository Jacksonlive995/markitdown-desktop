from __future__ import annotations

import importlib.util
import re
import threading
from pathlib import Path
from typing import Literal

EngineChoice = Literal["auto", "markitdown", "docling"]

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

_docling_lock = threading.Lock()
_docling_converter = None
_markitdown_instance = None


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


def _get_markitdown():
    global _markitdown_instance
    if _markitdown_instance is None:
        from markitdown import MarkItDown

        _markitdown_instance = MarkItDown()
    return _markitdown_instance


def _get_docling():
    global _docling_converter
    if _docling_converter is None:
        with _docling_lock:
            if _docling_converter is None:
                from docling.document_converter import DocumentConverter

                _docling_converter = DocumentConverter()
    return _docling_converter


def convert_file(file_path: Path, engine: EngineChoice = "auto") -> tuple[str, str]:
    chosen = resolve_engine(file_path, engine)

    if chosen == "markitdown":
        md = _get_markitdown()
        result = md.convert(str(file_path))
        text = result.text_content or ""
        return text, "markitdown"

    converter = _get_docling()
    result = converter.convert(str(file_path))
    text = result.document.export_to_markdown(image_placeholder="")
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text, "docling"
