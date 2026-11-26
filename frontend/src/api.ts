import type { ConversionTask, EngineChoice, HealthResponse, ServerConfig } from "./types";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function buildHeaders(config: ServerConfig, extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (config.token.trim()) {
    headers["Authorization"] = `Bearer ${config.token.trim()}`;
  }
  return headers;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchHealth(config: ServerConfig): Promise<HealthResponse> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/health`);
  if (!res.ok) {
    throw new Error(`健康检查失败 (${res.status})`);
  }
  return res.json();
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
    const detail = await res.text();
    throw new Error(`上传失败 (${res.status}): ${detail}`);
  }
  return res.json();
}

export async function listTasks(config: ServerConfig): Promise<ConversionTask[]> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`获取任务列表失败 (${res.status})`);
  }
  const data = await res.json();
  return data.tasks ?? [];
}

export async function getTask(config: ServerConfig, taskId: string): Promise<ConversionTask> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`获取任务详情失败 (${res.status})`);
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
    throw new Error(`保存失败 (${res.status})`);
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
    throw new Error(`重试失败 (${res.status})`);
  }
  return res.json();
}

export async function deleteTask(config: ServerConfig, taskId: string): Promise<void> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`删除任务失败 (${res.status})`);
  }
}

export function downloadLocalMarkdown(markdown: string, filename: string, taskId: string): void {
  const stem = filename.replace(/\.[^.]+$/, "") || taskId;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  triggerBlobDownload(blob, `${stem}.md`);
}

export async function downloadExportZip(config: ServerConfig, taskIds?: string[]): Promise<void> {
  const query = taskIds && taskIds.length > 0 ? `?ids=${encodeURIComponent(taskIds.join(","))}` : "";
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/export-zip${query}`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`批量导出失败 (${res.status})`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, "markitdown-export.zip");
}

export async function fetchSourceBlobUrl(
  config: ServerConfig,
  taskId: string,
): Promise<{ url: string; contentType: string }> {
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tasks/${taskId}/source`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new Error(`加载原文件失败 (${res.status})`);
  }
  const blob = await res.blob();
  return {
    url: URL.createObjectURL(blob),
    contentType: res.headers.get("content-type") || blob.type || "application/octet-stream",
  };
}
