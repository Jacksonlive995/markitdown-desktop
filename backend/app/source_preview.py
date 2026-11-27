from __future__ import annotations

import html
from pathlib import Path
from typing import Any


def _preview_xlsx(source_path: Path, max_sheets: int = 10, max_rows: int = 200, max_cols: int = 40) -> dict[str, Any]:
    from openpyxl import load_workbook

    wb = load_workbook(filename=str(source_path), read_only=True, data_only=True)
    sheets: list[dict[str, Any]] = []
    try:
        for name in wb.sheetnames[:max_sheets]:
            ws = wb[name]
            rows: list[list[str]] = []
            total_rows = 0
            max_seen_cols = 0
            for r_idx, row in enumerate(ws.iter_rows(values_only=True)):
                total_rows += 1
                if r_idx >= max_rows:
                    continue
                cells = ["" if v is None else str(v) for v in row[:max_cols]]
                # Trim trailing empty cells for display width
                while len(cells) > 1 and cells[-1] == "":
                    cells.pop()
                if any(c != "" for c in cells) or r_idx == 0:
                    max_seen_cols = max(max_seen_cols, len(cells))
                    rows.append(cells)
            # Normalize row lengths
            col_count = max(1, max_seen_cols)
            normalized = [r + [""] * (col_count - len(r)) for r in rows]
            sheets.append(
                {
                    "name": name,
                    "rows": normalized,
                    "total_rows": total_rows,
                    "truncated": total_rows > max_rows,
                }
            )
    finally:
        wb.close()

    return {"kind": "xlsx", "sheets": sheets}


def _render_docx_paragraph(paragraph: Any) -> str:
    style_name = (paragraph.style.name if paragraph.style else "") or ""
    parts: list[str] = []
    for run in paragraph.runs:
        text = html.escape(run.text or "")
        if not text:
            continue
        if run.bold and run.italic:
            parts.append(f"<strong><em>{text}</em></strong>")
        elif run.bold:
            parts.append(f"<strong>{text}</strong>")
        elif run.italic:
            parts.append(f"<em>{text}</em>")
        elif run.underline:
            parts.append(f"<u>{text}</u>")
        else:
            parts.append(text)
    inner = "".join(parts) if parts else html.escape(paragraph.text or "")
    if not inner.strip():
        return ""

    lower_style = style_name.lower()
    if lower_style.startswith("heading"):
        digits = "".join(ch for ch in style_name if ch.isdigit())
        level = min(4, max(1, int(digits))) if digits else 2
        return f"<h{level}>{inner}</h{level}>"
    if "title" in lower_style:
        return f"<h1>{inner}</h1>"
    if "list" in lower_style:
        return f"<p class=\"docx-list-item\">• {inner}</p>"
    return f"<p>{inner}</p>"


def _render_docx_table(table: Any) -> str:
    rows_html: list[str] = []
    for r_idx, row in enumerate(table.rows[:120]):
        tag = "th" if r_idx == 0 else "td"
        cells = "".join(
            f"<{tag}>{html.escape(cell.text.strip()).replace(chr(10), '<br/>')}</{tag}>"
            for cell in row.cells[:30]
        )
        rows_html.append(f"<tr>{cells}</tr>")
    return f"<table><tbody>{''.join(rows_html)}</tbody></table>"


def _preview_docx(source_path: Path) -> dict[str, Any]:
    from docx import Document
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(str(source_path))
    blocks: list[str] = []
    body = doc.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            rendered = _render_docx_paragraph(Paragraph(child, doc))
            if rendered:
                blocks.append(rendered)
        elif isinstance(child, CT_Tbl):
            blocks.append(_render_docx_table(Table(child, doc)))
        if len(blocks) >= 600:
            blocks.append("<p><em>...（文档较长，预览已截断至前 600 个区块）</em></p>")
            break

    return {
        "kind": "docx",
        "html": "\n".join(blocks) or "<p><em>（空白文档）</em></p>",
        "block_count": len(blocks),
    }


def _preview_pptx(source_path: Path) -> dict[str, Any]:
    from pptx import Presentation

    prs = Presentation(str(source_path))
    slides_html: list[str] = []
    for idx, slide in enumerate(prs.slides, start=1):
        parts: list[str] = [f"<h3>Slide {idx}</h3>"]
        for shape in slide.shapes:
            if shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    txt = html.escape(p.text.strip())
                    if txt:
                        parts.append(f"<p>{txt}</p>")
            if shape.has_table:
                rows_html = []
                for r_idx, row in enumerate(shape.table.rows):
                    tag = "th" if r_idx == 0 else "td"
                    cells = "".join(f"<{tag}>{html.escape(c.text.strip())}</{tag}>" for c in row.cells)
                    rows_html.append(f"<tr>{cells}</tr>")
                parts.append(f"<table><tbody>{''.join(rows_html)}</tbody></table>")
        slides_html.append(f"<section class=\"pptx-slide\">{''.join(parts)}</section>")
    return {
        "kind": "pptx",
        "html": "\n".join(slides_html) or "<p><em>（空白演示文稿）</em></p>",
        "slide_count": len(slides_html),
    }


def build_source_preview(source_path: Path, filename: str) -> dict[str, Any]:
    ext = Path(filename or source_path.name).suffix.lower()
    if ext in (".xlsx", ".xlsm"):
        return _preview_xlsx(source_path)
    if ext == ".docx":
        return _preview_docx(source_path)
    if ext == ".pptx":
        return _preview_pptx(source_path)
    return {"kind": "unsupported", "extension": ext}
