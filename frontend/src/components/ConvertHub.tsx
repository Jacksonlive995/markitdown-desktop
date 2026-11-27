import { useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Cpu,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderInput,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  Zap,
} from "lucide-react";
import type {
  ConversionOptions,
  ConversionTask,
  EngineChoice,
  HealthResponse,
  OcrModeChoice,
  ServerConfig,
} from "../types";
import { formatBytes, formatDuration, formatRelativeTime } from "../utils/markdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface ConvertHubProps {
  engine: EngineChoice;
  onEngineChange: (engine: EngineChoice) => void;
  options: ConversionOptions;
  onOptionsChange: (patch: Partial<ConversionOptions>) => void;
  config: ServerConfig;
  onOpenSettings: () => void;
  health: HealthResponse | null;
  uploading: boolean;
  onUploadFiles: (files: FileList | File[]) => void;
  onConvertSnippet: (payload: {
    title: string;
    content: string;
    format: "html" | "txt" | "csv" | "json";
  }) => Promise<void>;
  onConvertUrl: (url: string) => Promise<void>;
  onLoadSample: () => Promise<void>;
  tasks: ConversionTask[];
  onSelectTask: (taskId: string) => void;
}

const SUPPORTED_EXT_RE =
  /\.(pdf|docx?|xlsx?|pptx?|html?|csv|json|xml|txt|md|epub|png|jpe?g|webp|tiff?|bmp)$/i;

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

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length === 0) {
    return Array.from(dataTransfer.files || []).filter((f) => SUPPORTED_EXT_RE.test(f.name));
  }

  const collected: File[] = [];
  const walkEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        (entry as FileSystemFileEntry).file(
          (file) => {
            if (SUPPORTED_EXT_RE.test(file.name)) {
              collected.push(file);
            }
            resolve();
          },
          () => resolve(),
        );
      });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readAll = async (): Promise<FileSystemEntry[]> => {
        const all: FileSystemEntry[] = [];
        while (true) {
          const batch = await new Promise<FileSystemEntry[]>((resolve) => {
            reader.readEntries(
              (res) => resolve(res),
              () => resolve([]),
            );
          });
          if (batch.length === 0) break;
          all.push(...batch);
        }
        return all;
      };
      const children = await readAll();
      for (const child of children) {
        await walkEntry(child);
      }
    }
  };

  for (const entry of entries) {
    await walkEntry(entry);
  }
  return collected;
}

export function ConvertHub({
  engine,
  onEngineChange,
  options,
  onOptionsChange,
  config,
  onOpenSettings,
  health,
  uploading,
  onUploadFiles,
  onConvertSnippet,
  onConvertUrl,
  onLoadSample,
  tasks,
  onSelectTask,
}: ConvertHubProps) {
  const [inputMode, setInputMode] = useState<"file" | "url" | "snippet">("file");
  const [dragActive, setDragActive] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [snippetTitle, setSnippetTitle] = useState("剪贴板文稿");
  const [snippetFormat, setSnippetFormat] = useState<"html" | "txt" | "csv" | "json">("html");
  const [snippetContent, setSnippetContent] = useState("");
  const [convertingSnippet, setConvertingSnippet] = useState(false);

  const [urlInput, setUrlInput] = useState("");
  const [convertingUrl, setConvertingUrl] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const recentCompleted = tasks.filter((t) => t.status === "completed").slice(0, 6);
  const activeCount = tasks.filter(
    (t) => t.status === "queued" || t.status === "processing",
  ).length;

  const activeOptionsSummary = [
    options.pageRange ? `页码 ${options.pageRange}` : null,
    options.ocrMode !== "auto"
      ? options.ocrMode === "force_full_page"
        ? "强制整页 OCR"
        : "关闭 OCR"
      : null,
    options.extractImages ? "提取插图" : "纯文本",
    options.useVlm && config.vlmEnabled ? `VLM (${config.vlmModel})` : null,
    options.frontmatter ? "YAML Frontmatter" : null,
  ].filter(Boolean);

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

  const handleSubmitUrl = async () => {
    if (!urlInput.trim()) return;
    setConvertingUrl(true);
    try {
      await onConvertUrl(urlInput.trim());
      setUrlInput("");
    } finally {
      setConvertingUrl(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Hero Header */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              <Layers className="h-3 w-3" />
              <span>MarkItDown Desktop Studio v3.0</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              全格式文档转 Markdown 工作台
            </h1>
            <p className="text-xs text-muted-foreground sm:text-[13px]">
              支持 Office 全家桶、学术论文 PDF、插图资源提取、VLM 视觉解读、URL 网页抓取与一键写入 Obsidian 知识库
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
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
                <span>文件 / 文件夹</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode("url")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1 font-medium transition-all",
                  inputMode === "url"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Globe className="h-3.5 w-3.5" />
                <span>URL 网页 / 在线论文</span>
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
                <span>剪贴板 / HTML</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setOptionsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-accent transition-colors"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
              <span>高级转换参数</span>
              <span className="hidden text-[10.5px] text-muted-foreground md:inline">
                ({activeOptionsSummary.slice(0, 2).join(" · ")})
              </span>
              {optionsOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>

          {/* Collapsible Advanced Conversion Options Panel */}
          {optionsOpen && (
            <div className="border-b border-border bg-muted/20 px-5 py-3.5 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    PDF 页码范围（留空表示全部页面）
                  </label>
                  <input
                    type="text"
                    value={options.pageRange}
                    onChange={(e) => onOptionsChange({ pageRange: e.target.value })}
                    placeholder="例如：1-5 或 1-3, 8"
                    className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    Docling OCR 识别策略
                  </label>
                  <select
                    value={options.ocrMode}
                    onChange={(e) =>
                      onOptionsChange({ ocrMode: e.target.value as OcrModeChoice })
                    }
                    className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="auto">智能自动（仅对扫描区域启用 OCR）</option>
                    <option value="force_full_page">强制整页 OCR（适合纯图片扫描 PDF）</option>
                    <option value="off">关闭 OCR（仅提取原生电子文本层，速度最快）</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.extractImages}
                    onChange={(e) => onOptionsChange({ extractImages: e.target.checked })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span>提取文档内嵌图片至 assets/</span>
                </label>

                <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.frontmatter}
                    onChange={(e) => onOptionsChange({ frontmatter: e.target.checked })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span>注入 Obsidian YAML Frontmatter</span>
                </label>

                <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.useVlm}
                    onChange={(e) => {
                      if (e.target.checked && !config.vlmEnabled) {
                        onOpenSettings();
                      }
                      onOptionsChange({ useVlm: e.target.checked });
                    }}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>VLM 多模态插图解读</span>
                  </span>
                  {config.vlmEnabled ? (
                    <Badge variant="success" className="text-[10px]">
                      {config.vlmModel}
                    </Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenSettings();
                      }}
                      className="text-[10.5px] font-medium text-primary hover:underline"
                    >
                      去配置
                    </button>
                  )}
                </label>
              </div>
            </div>
          )}

          {inputMode === "file" ? (
            <div className="p-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const collected = await collectDroppedFiles(e.dataTransfer);
                  if (collected.length > 0) {
                    onUploadFiles(collected);
                  } else if (e.dataTransfer.files?.length) {
                    onUploadFiles(e.dataTransfer.files);
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-all",
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
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  hidden
                  {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      const supported = Array.from(e.target.files).filter((f) =>
                        SUPPORTED_EXT_RE.test(f.name),
                      );
                      if (supported.length > 0) {
                        onUploadFiles(supported);
                      }
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
                  {uploading
                    ? "正在上传并加入解析队列..."
                    : "拖拽文件或整个文件夹到此处，或点击选择"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  单文件上限 {health?.max_upload_mb ?? 200} MB · 支持递归导入文件夹、提取内嵌插图与实时进度追踪
                </p>

                <div className="mt-3.5 flex items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span>选择文件</span>
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                  >
                    <FolderInput className="h-3.5 w-3.5 text-primary" />
                    <span>批量导入文件夹</span>
                  </Button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                  {[
                    { label: "PDF 论文/扫描件", icon: FileText, color: "text-[#ff3b30]" },
                    { label: "Word (.docx)", icon: FileText, color: "text-primary" },
                    { label: "Excel / CSV", icon: FileSpreadsheet, color: "text-success" },
                    { label: "PPT 演示文稿", icon: FileText, color: "text-warning" },
                    { label: "图片 OCR + VLM", icon: ImageIcon, color: "text-[#af52de]" },
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
          ) : inputMode === "url" ? (
            <div className="space-y-3.5 p-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  输入网页文章链接或在线 PDF / Markdown 文档 URL
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary">
                    <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      type="url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSubmitUrl();
                      }}
                      placeholder="https://arxiv.org/pdf/2310.xxxxx.pdf 或 https://example.com/article"
                      className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSubmitUrl}
                    disabled={!urlInput.trim() || convertingUrl}
                    className="shrink-0 h-9 px-4"
                  >
                    {convertingUrl ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>抓取并转换</span>
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-muted/30 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                服务端会自动识别目标资源的 <code className="font-mono">Content-Type</code>：
                在线 PDF 论文自动路由至 <strong>Docling</strong> 提取公式与表格，技术博客 / HTML 网页自动交由{" "}
                <strong>MarkItDown</strong> 提取干净正文，并保留来源链接记录。
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
                      {task.assets && task.assets.length > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          · {task.assets.length} 图
                        </span>
                      )}
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
