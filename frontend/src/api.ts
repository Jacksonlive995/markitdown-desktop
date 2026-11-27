import type {
  ConversionOptions,
  ConversionTask,
  EngineChoice,
  HealthResponse,
  ServerConfig,
  SourcePreviewResponse,
  TaskEventMessage,
  VlmConfig,
} from "./types";

export function normalizeBaseUrl(url: string): string {
  return (url || "http://127.0.0.1:8000").trim().replace(/\/+$/, "");
}

function buildHeaders(config: Pick<ServerConfig, "token">, extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (config.token?.trim()) {
    headers["Authorization"] = `Bearer ${config.token.trim()}`;
  }
  return headers;
}

function buildVlmPayload(config: Pick<VlmConfig, "vlmEnabled" | "vlmBaseUrl" | "vlmApiKey" | "vlmModel" | "vlmPrompt">) {
  return {
    enabled: Boolean(config.vlmEnabled),
    base_url: config.vlmBaseUrl?.trim() || "",
    api_key: config.vlmApiKey?.trim() || "",
    model: config.vlmModel?.trim() || "",
    prompt: config.vlmPrompt?.trim() || "",
  };
}

async function parseErrorDetail(res: Response, fallbackPrefix: string): Promise<string> {
  let detail = await res.text();
  try {
    const parsed = JSON.parse(detail);
    if (parsed.detail) detail = parsed.detail;
  } catch {
    // ignore json parse error
  }
  return `${fallbackPrefix} (${res.status}): ${detail || res.statusText}`;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function getAssetUrl(
  config: Pick<ServerConfig, "baseUrl" | "token">,
  taskId: string,
  assetFilename: string,
): string {
  const cleanName = assetFilename.replace(/^assets\//, "");
  const base = `${normalizeBaseUrl(config.baseUrl)}/api/tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(cleanName)}`;
  if (config.token?.trim()) {
    return `${base}?token=${encodeURIComponent(config.token.trim())}`;
  }
  return base;
}

export async function fetchHealth(
  config: Pick<ServerConfig, "baseUrl" | "token">,
): Promise<HealthResponse> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/health`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`健康检查失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function testServerConnection(
  config: Pick<ServerConfig, "baseUrl" | "token">,
): Promise<{ health: HealthResponse; latencyMs: number; authOk: boolean }> {
  const start = performance.now();
  const health = await fetchHealth(config);
  const latencyMs = Math.max(1, Math.round(performance.now() - start));

  let authOk = true;
  if (health.auth_required || config.token?.trim()) {
    const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks`, {
      headers: buildHeaders(config),
    });
    if (res.status === 401 || res.status === 403) {
      authOk = false;
    }
  }
  return { health, latencyMs, authOk };
}

export async function testVlmConnection(
  config: ServerConfig,
): Promise<{ ok: boolean; model: string; reply: string }> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/vlm/test`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify(buildVlmPayload({ ...config, vlmEnabled: true })),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, "VLM 连接测试失败"));
  }
  return res.json();
}

export async function uploadFile(
  config: ServerConfig,
  file: File,
  engine: EngineChoice,
  options?: ConversionOptions,
): Promise<ConversionTask> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine", engine);
  if (options) {
    form.append("page_range", options.pageRange || "");
    form.append("ocr_mode", options.ocrMode || "auto");
    form.append("extract_images", String(options.extractImages));
    form.append("use_vlm", String(options.useVlm && config.vlmEnabled));
    form.append("frontmatter", String(options.frontmatter));
    if (options.useVlm && config.vlmEnabled) {
      form.append("vlm_config", JSON.stringify(buildVlmPayload(config)));
    }
  }

  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/convert`, {
    method: "POST",
    headers: buildHeaders(config),
    body: form,
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, "上传失败"));
  }
  return res.json();
}

export async function convertTextSnippet(
  config: ServerConfig,
  payload: {
    title: string;
    content: string;
    format: "html" | "txt" | "csv" | "json" | "xml" | "md";
    engine?: EngineChoice;
    frontmatter?: boolean;
  },
): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/convert-text`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      title: payload.title || "剪贴板文稿",
      content: payload.content,
      format: payload.format,
      engine: payload.engine ?? "markitdown",
      frontmatter: payload.frontmatter ?? false,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, "片段转换失败"));
  }
  return res.json();
}

export async function convertUrl(
  config: ServerConfig,
  url: string,
  engine: EngineChoice,
  options?: ConversionOptions,
): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/convert-url`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      url: url.trim(),
      engine,
      page_range: options?.pageRange || "",
      ocr_mode: options?.ocrMode || "auto",
      extract_images: options?.extractImages ?? true,
      use_vlm: Boolean(options?.useVlm && config.vlmEnabled),
      frontmatter: options?.frontmatter ?? false,
      vlm_config: options?.useVlm && config.vlmEnabled ? buildVlmPayload(config) : null,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, "URL 抓取转换失败"));
  }
  return res.json();
}

export async function listTasks(config: ServerConfig, query?: string): Promise<ConversionTask[]> {
  const params = new URLSearchParams();
  if (query && query.trim()) {
    params.set("q", query.trim());
  }
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks${qs}`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`获取任务列表失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.tasks ?? [];
}

export function subscribeTaskEvents(
  config: Pick<ServerConfig, "baseUrl" | "token">,
  onEvent: (event: TaskEventMessage) => void,
  onError?: () => void,
): () => void {
  const base = `${normalizeBaseUrl(config.baseUrl)}/api/tasks/events`;
  const url = config.token?.trim()
    ? `${base}?token=${encodeURIComponent(config.token.trim())}`
    : base;
  const es = new EventSource(url);
  es.onmessage = (evt) => {
    try {
      const parsed = JSON.parse(evt.data) as TaskEventMessage;
      onEvent(parsed);
    } catch {
      // ignore malformed event
    }
  };
  es.onerror = () => {
    onError?.();
  };
  return () => {
    es.close();
  };
}

export async function getTask(config: ServerConfig, taskId: string): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`获取任务详情失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function updateTaskMarkdown(
  config: ServerConfig,
  taskId: string,
  markdown: string,
): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/markdown`, {
    method: "PUT",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({ markdown }),
  });
  if (!res.ok) {
    throw new Error(`保存失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function updateTaskMeta(
  config: ServerConfig,
  taskId: string,
  payload: { filename?: string; pinned?: boolean },
): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`更新文档属性失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function retryTask(
  config: ServerConfig,
  taskId: string,
  engine?: EngineChoice,
  options?: ConversionOptions,
): Promise<ConversionTask> {
  const body: Record<string, unknown> = { engine: engine ?? null };
  if (options) {
    body.page_range = options.pageRange || "";
    body.ocr_mode = options.ocrMode || "auto";
    body.extract_images = options.extractImages;
    body.use_vlm = Boolean(options.useVlm && config.vlmEnabled);
    body.frontmatter = options.frontmatter;
    if (options.useVlm && config.vlmEnabled) {
      body.vlm_config = buildVlmPayload(config);
    }
  }
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/retry`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`重试失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function cancelTask(config: ServerConfig, taskId: string): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`取消任务失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function deleteTask(config: ServerConfig, taskId: string): Promise<void> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`删除任务失败 (HTTP ${res.status})`);
  }
}

export async function batchDeleteTasks(config: ServerConfig, taskIds: string[]): Promise<string[]> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/batch-delete`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({ task_ids: taskIds }),
  });
  if (!res.ok) {
    throw new Error(`批量删除失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.deleted ?? [];
}

export async function analyzeTaskAsset(
  config: ServerConfig,
  taskId: string,
  assetFilename: string,
  prompt?: string,
): Promise<{ filename: string; model: string; description: string }> {
  const cleanName = assetFilename.replace(/^assets\//, "");
  const res = await fetch(
    `${normalizeBaseUrl(config.baseUrl)}/api/tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(cleanName)}/analyze`,
    {
      method: "POST",
      headers: buildHeaders(config, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        vlm_config: buildVlmPayload({ ...config, vlmEnabled: true }),
        prompt: prompt || null,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, "AI 视觉解读失败"));
  }
  return res.json();
}

export async function fetchSourcePreview(
  config: ServerConfig,
  taskId: string,
): Promise<SourcePreviewResponse> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/source-preview`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`加载 Office 原件预览失败 (HTTP ${res.status})`);
  }
  return res.json();
}

export async function exportTaskToVault(
  config: ServerConfig,
  taskId: string,
  markdownOverride?: string,
): Promise<{ md_path: string; assets_dir?: string | null; assets_copied: number }> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/export-to-vault`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      vault_path: config.vaultPath,
      subfolder: config.vaultSubfolder || "MarkItDown",
      include_frontmatter: config.vaultAutoFrontmatter,
      markdown: markdownOverride ?? null,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, "写入知识库失败"));
  }
  return res.json();
}

export function downloadLocalMarkdown(markdown: string, filename: string, taskId: string): void {
  const stem = filename.replace(/\.[^.]+$/, "") || taskId;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  triggerBlobDownload(blob, `${stem}.md`);
}

export function downloadLocalTxt(plainText: string, filename: string, taskId: string): void {
  const stem = filename.replace(/\.[^.]+$/, "") || taskId;
  const blob = new Blob([plainText], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, `${stem}.txt`);
}

async function inlineHtmlImagesAsBase64(htmlBody: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlBody, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      try {
        const resp = await fetch(src);
        if (!resp.ok) return;
        const blob = await resp.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.setAttribute("src", dataUrl);
      } catch {
        // leave original src on failure
      }
    }),
  );
  return doc.body.innerHTML;
}

export async function downloadLocalHtml(
  htmlBody: string,
  filename: string,
  taskId: string,
): Promise<void> {
  const stem = filename.replace(/\.[^.]+$/, "") || taskId;
  const inlinedBody = await inlineHtmlImagesAsBase64(htmlBody);
  const fullHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${stem}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
      max-width: 780px;
      margin: 40px auto;
      padding: 0 24px 64px;
      line-height: 1.75;
      color: #1d1d1f;
      background: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #f5f5f7; background: #161618; }
      pre, code { background: #242428 !important; }
      th, td { border-color: rgba(255,255,255,0.14) !important; }
      blockquote { background: rgba(10,132,255,0.08) !important; color: #a1a1a6 !important; }
    }
    h1, h2, h3, h4 { letter-spacing: -0.015em; font-weight: 650; }
    h2 { border-bottom: 1px solid rgba(128,128,128,0.2); padding-bottom: 0.3em; margin-top: 1.8em; }
    pre { background: #f5f6f8; padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-size: 0.88em; }
    code { font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; background: rgba(128,128,128,0.12); padding: 2px 5px; border-radius: 5px; font-size: 0.88em; }
    pre code { background: transparent; padding: 0; }
    table { width: 100%; border-collapse: collapse; margin: 1.4em 0; font-size: 0.92em; }
    th, td { border: 1px solid rgba(128,128,128,0.22); padding: 8px 12px; text-align: left; }
    th { background: rgba(128,128,128,0.08); font-weight: 600; }
    blockquote { margin: 1.2em 0; padding: 8px 16px; border-left: 3px solid #007aff; background: rgba(0,122,255,0.05); border-radius: 0 8px 8px 0; color: #555; }
    img { max-width: 100%; border-radius: 8px; }
  </style>
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
  triggerBlobDownload(blob, `${stem}.html`);
}

export function printDocumentAsPdf(htmlBody: string, filename: string): void {
  const stem = filename.replace(/\.[^.]+$/, "") || "Document";
  const win = window.open("", "_blank", "width=900,height=720");
  if (!win) {
    window.print();
    return;
  }
  win.document.write(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${stem}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
      max-width: 740px;
      margin: 24px auto;
      padding: 0 20px;
      line-height: 1.7;
      color: #111;
    }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    pre { background: #f4f5f7; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #f3f4f6; }
    blockquote { border-left: 3px solid #007aff; margin: 12px 0; padding: 4px 14px; color: #555; }
    img { max-width: 100%; }
  </style>
</head>
<body>
${htmlBody}
<script>
  window.onload = function() { setTimeout(function() { window.print(); }, 250); };
</script>
</body>
</html>`);
  win.document.close();
}

export async function downloadExportZip(config: ServerConfig, taskIds?: string[]): Promise<void> {
  const query = taskIds && taskIds.length > 0 ? `?ids=${encodeURIComponent(taskIds.join(","))}` : "";
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/export-zip${query}`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`批量导出失败 (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, "markitdown-export.zip");
}

export async function fetchSourceBlobUrl(
  config: ServerConfig,
  taskId: string,
): Promise<{ url: string; contentType: string; blob: Blob }> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/source`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`加载原文件失败 (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  return {
    url: URL.createObjectURL(blob),
    contentType: res.headers.get("content-type") || blob.type || "application/octet-stream",
    blob,
  };
}
