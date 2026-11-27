from __future__ import annotations

import base64
import mimetypes
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import httpx

DEFAULT_VLM_PROMPT = (
    "请仔细分析这张文档插图（图表、架构图、流程图、公式截图或数据图），"
    "用简洁结构化的中文 Markdown 描述其核心内容与关键数据；"
    "如果是流程图或架构图，请附带一段 Mermaid 图表代码。"
)


@dataclass
class VlmConfig:
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    prompt: str = DEFAULT_VLM_PROMPT

    @classmethod
    def from_dict_or_env(cls, data: dict[str, Any] | None = None) -> VlmConfig:
        raw = data or {}
        base_url = (raw.get("base_url") or raw.get("vlmBaseUrl") or os.getenv("VLM_BASE_URL", "")).strip()
        api_key = (raw.get("api_key") or raw.get("vlmApiKey") or os.getenv("VLM_API_KEY", "")).strip()
        model = (raw.get("model") or raw.get("vlmModel") or os.getenv("VLM_MODEL", "")).strip()
        prompt = (raw.get("prompt") or raw.get("vlmPrompt") or os.getenv("VLM_PROMPT", "")).strip() or DEFAULT_VLM_PROMPT
        enabled_val = raw.get("enabled") if "enabled" in raw else raw.get("vlmEnabled")
        if enabled_val is None:
            enabled = bool(base_url and model)
        else:
            enabled = bool(enabled_val)
        return cls(
            enabled=enabled,
            base_url=base_url.rstrip("/"),
            api_key=api_key,
            model=model,
            prompt=prompt,
        )

    def is_ready(self) -> bool:
        return bool(self.enabled and self.base_url and self.model)


def _normalize_chat_url(base_url: str) -> str:
    clean = base_url.strip().rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    return f"{clean}/chat/completions"


def _build_headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    return headers


def encode_image_data_uri(image_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(image_path.name)
    mime = mime_type or "image/png"
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def describe_image(
    image_path: Path,
    cfg: VlmConfig,
    custom_prompt: str | None = None,
    timeout: float = 60.0,
) -> str:
    if not cfg.base_url or not cfg.model:
        raise ValueError("VLM base_url and model must be configured")
    data_uri = encode_image_data_uri(image_path)
    prompt_text = (custom_prompt or cfg.prompt or DEFAULT_VLM_PROMPT).strip()
    payload = {
        "model": cfg.model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            }
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
    }
    url = _normalize_chat_url(cfg.base_url)
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=_build_headers(cfg.api_key), json=payload)
        resp.raise_for_status()
        body = resp.json()
    choices = body.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    content = msg.get("content") or ""
    if isinstance(content, list):
        parts = [item.get("text", "") for item in content if isinstance(item, dict)]
        content = "\n".join(p for p in parts if p)
    return str(content).strip()


def test_vlm_connection(cfg: VlmConfig, timeout: float = 15.0) -> dict[str, Any]:
    if not cfg.base_url or not cfg.model:
        raise ValueError("请先填写 VLM Base URL 和模型名称")
    url = _normalize_chat_url(cfg.base_url)
    payload = {
        "model": cfg.model,
        "messages": [{"role": "user", "content": "Reply with OK."}],
        "max_tokens": 8,
        "temperature": 0,
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=_build_headers(cfg.api_key), json=payload)
        resp.raise_for_status()
        body = resp.json()
    choices = body.get("choices") or []
    reply = ""
    if choices:
        reply = str((choices[0].get("message") or {}).get("content") or "").strip()
    return {"ok": True, "model": body.get("model", cfg.model), "reply": reply}


class _CompletionsAdapter:
    def __init__(self, cfg: VlmConfig) -> None:
        self._cfg = cfg

    def create(self, *, model: str, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
        url = _normalize_chat_url(self._cfg.base_url)
        payload: dict[str, Any] = {
            "model": model or self._cfg.model,
            "messages": messages,
        }
        for key in ("max_tokens", "temperature", "top_p"):
            if key in kwargs and kwargs[key] is not None:
                payload[key] = kwargs[key]
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=_build_headers(self._cfg.api_key), json=payload)
            resp.raise_for_status()
            body = resp.json()
        choices = []
        for ch in body.get("choices") or []:
            msg = ch.get("message") or {}
            choices.append(SimpleNamespace(message=SimpleNamespace(content=msg.get("content", ""))))
        return SimpleNamespace(choices=choices)


class OpenAICompatibleClient:
    """Lightweight duck-typed OpenAI client compatible with MarkItDown(llm_client=...)."""

    def __init__(self, cfg: VlmConfig) -> None:
        self.chat = SimpleNamespace(completions=_CompletionsAdapter(cfg))


ASSET_IMG_RE = re.compile(r"!\[([^\]]*)\]\((assets/[^)\s]+)\)")


def enrich_markdown_assets(
    markdown: str,
    assets_dir: Path,
    cfg: VlmConfig,
    progress_cb: Callable[[int, str], None] | None = None,
    cancel_event: threading.Event | None = None,
    max_images: int = 12,
) -> str:
    if not cfg.is_ready() or not assets_dir.exists():
        return markdown

    matches = list(ASSET_IMG_RE.finditer(markdown))
    if not matches:
        return markdown

    seen: list[str] = []
    for m in matches:
        rel = m.group(2)
        if rel not in seen:
            seen.append(rel)
    targets = seen[:max_images]
    descriptions: dict[str, str] = {}

    for idx, rel in enumerate(targets, start=1):
        if cancel_event and cancel_event.is_set():
            raise InterruptedError("Task cancelled during VLM analysis")
        img_name = Path(rel).name
        img_path = assets_dir / img_name
        if not img_path.exists() or not img_path.is_file():
            continue
        if progress_cb:
            pct = 78 + int((idx - 1) / max(1, len(targets)) * 18)
            progress_cb(pct, f"正在调用 VLM 解读插图 ({idx}/{len(targets)})")
        try:
            desc = describe_image(img_path, cfg)
            if desc:
                descriptions[rel] = desc
        except Exception as exc:
            descriptions[rel] = f"*(VLM 视觉解读跳过：{exc})*"

    if not descriptions:
        return markdown

    def _replace(match: re.Match[str]) -> str:
        full = match.group(0)
        rel = match.group(2)
        desc = descriptions.get(rel)
        if not desc:
            return full
        quoted = "\n".join(f"> {line}" if line.strip() else ">" for line in desc.splitlines())
        return f"{full}\n\n> **AI 视觉解读 ({cfg.model})**\n>\n{quoted}\n"

    return ASSET_IMG_RE.sub(_replace, markdown)
