import { useMemo, useState } from "react";
import {
  AlignLeft,
  Clock,
  Cpu,
  FileText,
  Hash,
  Info,
  ListTree,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  Wand2,
} from "lucide-react";
import type {
  CleanupAction,
  ConversionTask,
  EngineChoice,
  InspectorTab,
  MarkdownStats,
  ReaderTypography,
  TocItem,
} from "../types";
import { formatBytes, formatDuration } from "../utils/markdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface InspectorPanelProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  toc: TocItem[];
  activeHeadingId: string | null;
  onSelectHeading: (id: string) => void;
  stats: MarkdownStats;
  task: ConversionTask;
  typography: ReaderTypography;
  onTypographyChange: (patch: Partial<ReaderTypography>) => void;
  onCleanup: (action: CleanupAction) => void;
  onRestoreOriginal: () => void;
  onRetryEngine: (engine: EngineChoice) => void;
  className?: string;
}

const CLEANUP_TOOLS: {
  id: CleanupAction;
  title: string;
  desc: string;
  highlight?: boolean;
}[] = [
  {
    id: "smart_all",
    title: "一键智能排版精修",
    desc: "自动清理标签、规范标题、优化中英间距、对齐表格并压缩空行",
    highlight: true,
  },
  {
    id: "merge_pdf_broken_lines",
    title: "修复 PDF 跨行断句",
    desc: "智能合并因 PDF 双栏或硬换行被拆碎的同段落句子",
  },
  {
    id: "collapse_blank_lines",
    title: "压缩多余空行",
    desc: "将连续 3 行以上空行收敛为标准 Markdown 段落间距",
  },
  {
    id: "normalize_headings",
    title: "规范化标题层级",
    desc: "自动补齐 # 后空格并消除跳级标题，生成干净目录树",
  },
  {
    id: "cjk_spacing",
    title: "中英文与数字间距优化",
    desc: "在中文与英文字母、数字之间自动插入半角空格（跳过代码块）",
  },
  {
    id: "format_tables",
    title: "GFM 表格对齐美化",
    desc: "重新计算表格列宽并对齐分隔符，让源码也清晰易读",
  },
  {
    id: "strip_artifacts",
    title: "清除残留图片占位符",
    desc: "移除 <!-- image -->、孤立页码与空白链接标记",
  },
];

export function InspectorPanel({
  tab,
  onTabChange,
  toc,
  activeHeadingId,
  onSelectHeading,
  stats,
  task,
  typography,
  onTypographyChange,
  onCleanup,
  onRestoreOriginal,
  onRetryEngine,
  className,
}: InspectorPanelProps) {
  const [tocQuery, setTocQuery] = useState("");

  const filteredToc = useMemo(() => {
    const q = tocQuery.trim().toLowerCase();
    if (!q) return toc;
    return toc.filter((item) => item.text.toLowerCase().includes(q));
  }, [toc, tocQuery]);

  const currentEngine = task.engine_used || task.engine_requested;
  const alternateEngine: EngineChoice =
    currentEngine === "docling" ? "markitdown" : "docling";

  return (
    <aside
      className={cn(
        "flex w-[272px] shrink-0 flex-col border-l border-border bg-sidebar/90 glass min-h-0",
        className,
      )}
    >
      {/* Segmented Header */}
      <div className="border-b border-border p-2.5">
        <div className="grid grid-cols-3 rounded-lg bg-secondary p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onTabChange("toc")}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-[6px] py-1 font-medium transition-all",
              tab === "toc"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ListTree className="h-3.5 w-3.5" />
            <span>目录 ({toc.length})</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("info")}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-[6px] py-1 font-medium transition-all",
              tab === "info"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Info className="h-3.5 w-3.5" />
            <span>属性</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("tools")}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-[6px] py-1 font-medium transition-all",
              tab === "tools"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>排版</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Table of Contents */}
      {tab === "toc" && (
        <div className="flex flex-1 flex-col min-h-0">
          {toc.length > 4 && (
            <div className="border-b border-border/60 px-2.5 py-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={tocQuery}
                  onChange={(e) => setTocQuery(e.target.value)}
                  placeholder="筛选章节标题..."
                  className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2">
            {filteredToc.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center text-muted-foreground">
                <ListTree className="h-6 w-6 opacity-40" />
                <p className="text-xs">
                  {toc.length === 0 ? "当前文档未检测到 Markdown 标题" : "没有匹配的章节标题"}
                </p>
              </div>
            ) : (
              <nav className="flex flex-col gap-0.5">
                {filteredToc.map((item) => {
                  const isActive = activeHeadingId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectHeading(item.id)}
                      title={item.text}
                      style={{ paddingLeft: `${(item.level - 1) * 12 + 10}px` }}
                      className={cn(
                        "group flex items-center gap-1.5 rounded-lg pr-2.5 py-1.5 text-left text-xs transition-colors",
                        isActive
                          ? "bg-primary/12 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span className="shrink-0 font-mono text-[10px] opacity-50">
                        H{item.level}
                      </span>
                      <span className="truncate">{item.text}</span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Document Info & Metrics */}
      {tab === "info" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Metrics Grid */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              内容统计
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-card p-2.5">
                <div className="text-[11px] text-muted-foreground">总词数 (中+英)</div>
                <div className="mt-0.5 text-base font-bold text-foreground">
                  {stats.words.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  中文 {stats.cjk} · 英文 {stats.latin}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-2.5">
                <div className="text-[11px] text-muted-foreground">预计阅读</div>
                <div className="mt-0.5 text-base font-bold text-foreground">
                  {stats.readingMinutes} 分钟
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {stats.chars.toLocaleString()} 字符 · {stats.lines} 行
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {[
                { label: "标题", value: stats.headings },
                { label: "表格", value: stats.tables },
                { label: "代码", value: stats.codeBlocks },
                { label: "公式", value: stats.formulas },
              ].map((m, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-card py-1.5 text-center"
                >
                  <div className="text-xs font-semibold text-foreground">{m.value}</div>
                  <div className="text-[10px] text-muted-foreground">{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Task Metadata */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              转换元数据
            </div>
            <div className="rounded-xl border border-border bg-card divide-y divide-border/60 text-xs">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" />
                  <span>解析引擎</span>
                </span>
                <Badge variant="default">{currentEngine}</Badge>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span>源文件大小</span>
                </span>
                <span className="font-mono text-foreground">{formatBytes(task.file_size)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>转换耗时</span>
                </span>
                <span className="font-mono text-foreground">
                  {formatDuration(task.duration_ms)}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" />
                  <span>任务 ID</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {task.task_id}
                </span>
              </div>
              {task.assets && task.assets.length > 0 && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">提取插图资源</span>
                  <Badge variant="secondary">{task.assets.length} 张</Badge>
                </div>
              )}
              {task.engine_snapshots && task.engine_snapshots.length > 1 && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">双引擎 A/B 快照</span>
                  <Badge variant="success">已就绪</Badge>
                </div>
              )}
              {task.source_url && (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="shrink-0 text-muted-foreground">来源网址</span>
                  <a
                    href={task.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-primary hover:underline"
                    title={task.source_url}
                  >
                    {task.source_url}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Engine Re-run & Version Actions */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              解析与版本控制
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              onClick={() => onRetryEngine(alternateEngine)}
            >
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <span>改用 {alternateEngine === "docling" ? "Docling" : "MarkItDown"} 重新解析</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              onClick={onRestoreOriginal}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>还原为初始转换结果</span>
            </Button>
          </div>
        </div>
      )}

      {/* Tab 3: Typography & Post-Processing Tools */}
      {tab === "tools" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Typography Section */}
          <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Type className="h-3.5 w-3.5 text-primary" />
              <span>阅读排版外观</span>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">正文字体</div>
              <div className="grid grid-cols-2 rounded-lg bg-secondary p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => onTypographyChange({ font: "sans" })}
                  className={cn(
                    "rounded-[6px] py-1 font-medium transition-all",
                    typography.font === "sans"
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground",
                  )}
                >
                  无衬线 (现代)
                </button>
                <button
                  type="button"
                  onClick={() => onTypographyChange({ font: "serif" })}
                  className={cn(
                    "rounded-[6px] py-1 font-serif font-medium transition-all",
                    typography.font === "serif"
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground",
                  )}
                >
                  衬线 (书籍感)
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>字号大小</span>
                <span className="font-mono text-foreground">{typography.fontSize}px</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[14, 15, 16, 18].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => onTypographyChange({ fontSize: sz })}
                    className={cn(
                      "rounded-md border py-1 text-xs font-medium transition-all",
                      typography.fontSize === sz
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {sz}px
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">版面宽度</div>
              <div className="grid grid-cols-3 rounded-lg bg-secondary p-0.5 text-xs">
                {(
                  [
                    ["compact", "紧凑"],
                    ["standard", "标准"],
                    ["wide", "宽屏"],
                  ] as const
                ).map(([w, label]) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => onTypographyChange({ width: w })}
                    className={cn(
                      "rounded-[6px] py-1 font-medium transition-all",
                      typography.width === w
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Markdown Cleanup Tools */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              <span>Markdown 智能清洗工具</span>
            </div>

            <div className="space-y-1.5">
              {CLEANUP_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onCleanup(tool.id)}
                  className={cn(
                    "w-full rounded-xl border p-2.5 text-left transition-all",
                    tool.highlight
                      ? "border-primary/40 bg-primary/[0.06] hover:bg-primary/10"
                      : "border-border bg-card hover:border-foreground/20 hover:bg-accent/50",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      {tool.highlight ? (
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <AlignLeft className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {tool.title}
                    </span>
                    {tool.highlight && <Badge variant="default">推荐</Badge>}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {tool.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
