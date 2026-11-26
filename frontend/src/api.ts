import type { ConversionTask, EngineChoice, HealthResponse, ServerConfig } from "./types";

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

  // Verify token against /api/tasks if auth is required or token is provided
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

export async function uploadFile(
  config: ServerConfig,
  file: File,
  engine: EngineChoice,
): Promise<ConversionTask> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine", engine);

  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/convert`, {
    method: "POST",
    headers: buildHeaders(config),
    body: form,
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      if (parsed.detail) detail = parsed.detail;
    } catch {
      // ignore json parse error
    }
    throw new Error(`上传失败 (${res.status}): ${detail}`);
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
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`片段转换失败 (${res.status}): ${detail}`);
  }
  return res.json();
}

export async function listTasks(config: ServerConfig): Promise<ConversionTask[]> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`获取任务列表失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.tasks ?? [];
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
): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/retry`, {
    method: "POST",
    headers: buildHeaders(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({ engine: engine ?? null }),
  });
  if (!res.ok) {
    throw new Error(`重试失败 (HTTP ${res.status})`);
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

export function downloadLocalHtml(htmlBody: string, filename: string, taskId: string): void {
  const stem = filename.replace(/\.[^.]+$/, "") || taskId;
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
${htmlBody}
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
