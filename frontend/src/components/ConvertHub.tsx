import { useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  Cpu,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Sparkles,
  UploadCloud,
  Zap,
} from "lucide-react";
import type { ConversionTask, EngineChoice, HealthResponse } from "../types";
import { formatBytes, formatDuration, formatRelativeTime } from "../utils/markdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface ConvertHubProps {
  engine: EngineChoice;
  onEngineChange: (engine: EngineChoice) => void;
  health: HealthResponse | null;
  uploading: boolean;
  onUploadFiles: (files: FileList | File[]) => void;
  onConvertSnippet: (payload: {
    title: string;
    content: string;
    format: "html" | "txt" | "csv" | "json";
  }) => Promise<void>;
  onLoadSample: () => Promise<void>;
  tasks: ConversionTask[];
  onSelectTask: (taskId: string) => void;
}

const ENGINE_OPTIONS: {
  id: EngineChoice;
  title: string;
  badge: string;
  desc: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: "auto",
    title: "智能双引擎路由",
    badge: "推荐",
    desc: "Office / HTML / CSV 自动走 MarkItDown 极速通道；PDF / 学术论文 / 扫描图片自动启用 Docling 版面分析",
    icon: Sparkles,
  },
  {
    id: "markitdown",
    title: "MarkItDown 极速",
    badge: "毫秒级",
    desc: "微软开源轻量引擎，适合 Word、Excel、PPT、HTML、CSV、JSON 等原生数字文档",
    icon: Zap,
  },
  {
    id: "docling",
    title: "Docling 深度解析",
    badge: "高精度 OCR",
    desc: "IBM 深度版面分析与 TableFormer 表格重构，专为复杂双栏论文、跨页表格与扫描件打造",
    icon: Cpu,
  },
];

export function ConvertHub({
  engine,
  onEngineChange,
  health,
  uploading,
  onUploadFiles,
  onConvertSnippet,
  onLoadSample,
  tasks,
  onSelectTask,
}: ConvertHubProps) {
  const [inputMode, setInputMode] = useState<"file" | "snippet">("file");
  const [dragActive, setDragActive] = useState(false);
  const [snippetTitle, setSnippetTitle] = useState("剪贴板文稿");
  const [snippetFormat, setSnippetFormat] = useState<"html" | "txt" | "csv" | "json">("html");
  const [snippetContent, setSnippetContent] = useState("");
  const [convertingSnippet, setConvertingSnippet] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const recentCompleted = tasks.filter((t) => t.status === "completed").slice(0, 6);
  const activeCount = tasks.filter(
    (t) => t.status === "queued" || t.status === "processing",
  ).length;

  const handleReadClipboard = async () => {
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/html")) {
            const blob = await item.getType("text/html");
            const html = await blob.text();
            setSnippetFormat("html");
            setSnippetContent(html);
            return;
          }
        }
      }
      const text = await navigator.clipboard.readText();
      if (text) {
        setSnippetContent(text);
        if (text.trim().startsWith("<")) setSnippetFormat("html");
      }
    } catch {
      // fallback if clipboard permission denied
    }
  };

  const handleSubmitSnippet = async () => {
    if (!snippetContent.trim()) return;
    setConvertingSnippet(true);
    try {
      await onConvertSnippet({
        title: snippetTitle.trim() || "剪贴板文稿",
        content: snippetContent,
        format: snippetFormat,
      });
      setSnippetContent("");
    } finally {
      setConvertingSnippet(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Hero Header */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              <Layers className="h-3 w-3" />
              <span>MarkItDown Desktop Studio</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              全格式文档转 Markdown 工作台
            </h1>
            <p className="text-xs text-muted-foreground sm:text-[13px]">
              支持 Office 全家桶、学术论文 PDF、扫描件 OCR 与网页富文本片段，内置阅读排版、源码精修与原文对照校对
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={onLoadSample}
            disabled={uploading}
            className="shrink-0 self-start sm:self-auto"
          >
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <span>载入示例论文体验</span>
          </Button>
        </div>

        {/* Engine Selection Cards */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {ENGINE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = engine === opt.id;
            const disabled = opt.id === "docling" && health ? !health.engines.docling : false;

            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => onEngineChange(opt.id)}
                className={cn(
                  "group relative flex flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/[0.06] shadow-[0_0_0_1px_var(--primary)]"
                    : "border-border bg-card hover:border-foreground/20 hover:bg-card/80",
                  disabled && "opacity-45 cursor-not-allowed",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[13px] font-semibold text-foreground">{opt.title}</span>
                  </div>
                  <Badge variant={selected ? "default" : "secondary"}>{opt.badge}</Badge>
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Main Input Card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
            <div className="inline-flex rounded-lg bg-secondary p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setInputMode("file")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1 font-medium transition-all",
                  inputMode === "file"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>文件批量上传</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode("snippet")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1 font-medium transition-all",
                  inputMode === "snippet"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span>剪贴板 / HTML / 文本片段</span>
              </button>
            </div>

            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              单文件上限 {health?.max_upload_mb ?? 200} MB · 支持多选并发排队
            </span>
          </div>

          {inputMode === "file" ? (
            <div className="p-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  if (e.dataTransfer.files?.length) {
                    onUploadFiles(e.dataTransfer.files);
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all",
                  dragActive
                    ? "border-primary bg-primary/10 scale-[0.995]"
                    : "border-border/90 bg-muted/25 hover:border-primary/60 hover:bg-primary/[0.03]",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.csv,.json,.xml,.txt,.md,.epub,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      onUploadFiles(e.target.files);
                      e.target.value = "";
                    }
                  }}
                />

                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-2xs transition-transform group-hover:scale-105">
                  {uploading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <UploadCloud className="h-6 w-6" />
                  )}
                </div>

                <h3 className="text-sm font-semibold text-foreground">
                  {uploading ? "正在上传并加入解析队列..." : "拖拽一个或多个文件到此处，或点击选择文件"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  自动提取章节目录、GFM 表格与 LaTeX 数学公式，保留源文件供左右对照校对
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                  {[
                    { label: "PDF 论文/扫描件", icon: FileText, color: "text-[#ff3b30]" },
                    { label: "Word (.docx)", icon: FileText, color: "text-primary" },
                    { label: "Excel / CSV", icon: FileSpreadsheet, color: "text-success" },
                    { label: "PPT 演示文稿", icon: FileText, color: "text-warning" },
                    { label: "图片 OCR", icon: ImageIcon, color: "text-[#af52de]" },
                    { label: "HTML / EPUB / JSON", icon: FileCode2, color: "text-muted-foreground" },
                  ].map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <Icon className={cn("h-3 w-3", item.color)} />
                        {item.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={snippetTitle}
                  onChange={(e) => setSnippetTitle(e.target.value)}
                  placeholder="文稿标题..."
                  className="h-8 flex-1 min-w-[160px] rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
                <select
                  value={snippetFormat}
                  onChange={(e) =>
                    setSnippetFormat(e.target.value as "html" | "txt" | "csv" | "json")
                  }
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="html">HTML 网页富文本片段</option>
                  <option value="csv">CSV 表格数据</option>
                  <option value="json">JSON 结构化数据</option>
                  <option value="txt">纯文本段落</option>
                </select>
                <Button variant="secondary" size="sm" onClick={handleReadClipboard}>
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  <span>粘贴系统剪贴板</span>
                </Button>
              </div>

              <textarea
                value={snippetContent}
                onChange={(e) => setSnippetContent(e.target.value)}
                rows={6}
                placeholder="在此粘贴网页 HTML 源码、飞书/Notion 复制的富文本 HTML、CSV 数据或文本段落..."
                className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-primary"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  提示：点击「粘贴系统剪贴板」可自动读取复制的网页富文本（text/html）并转为干净的 Markdown
                </span>
                <Button
                  size="sm"
                  onClick={handleSubmitSnippet}
                  disabled={!snippetContent.trim() || convertingSnippet}
                >
                  {convertingSnippet ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>转换为 Markdown</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Recent Documents Section */}
        {recentCompleted.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                最近转换完成 ({recentCompleted.length})
                {activeCount > 0 && (
                  <span className="ml-2 text-primary">· {activeCount} 个任务正在解析中</span>
                )}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {recentCompleted.map((task) => (
                <button
                  key={task.task_id}
                  type="button"
                  onClick={() => onSelectTask(task.task_id)}
                  className="group flex flex-col justify-between gap-2.5 rounded-2xl border border-border bg-card p-3.5 text-left shadow-2xs transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-foreground group-hover:text-primary">
                        {task.filename}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{formatBytes(task.file_size)}</span>
                        <span>·</span>
                        <span>{formatDuration(task.duration_ms)}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(task.created_at)}</span>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-primary" />
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 text-success font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      {task.engine_used || task.engine_requested}
                    </span>
                    <span>{task.markdown_length.toLocaleString()} 字符</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
