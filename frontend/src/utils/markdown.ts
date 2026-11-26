import type { TocItem } from "../types";

export function slugifyHeading(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || "section";
}

export function extractToc(markdown: string): TocItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: TocItem[] = [];
  const counts = new Map<string, number>();
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (!match) continue;

    const level = match[1].length;
    const rawText = match[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
    if (!rawText) continue;

    const base = slugifyHeading(rawText);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen}`;
    items.push({ id, level, text: rawText });
  }
  return items;
}

export function countMarkdownWords(markdown: string): { chars: number; words: number } {
  const plain = markdown.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~[\]()|-]/g, " ");
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (plain.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) ?? []).length;
  return {
    chars: markdown.length,
    words: cjk + latin,
  };
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
