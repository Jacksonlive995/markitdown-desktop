import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import {
  Bold,
  Code,
  Columns2,
  Cpu,
  Diff,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  Minus,
  Quote,
  RotateCcw,
  Sigma,
  Sparkles,
  Table,
  Unlink2,
} from "lucide-react";
import type {
  CleanupAction,
  DiffMode,
  EditSubMode,
  EngineChoice,
  ReaderTypography,
  ServerConfig,
} from "../types";
import { computeLineDiff, extractToc } from "../utils/markdown";
import { MarkdownPreview } from "./MarkdownPreview";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  value: string;
  originalValue?: string;
  engineUsed?: string | null;
  engineResults?: Record<string, string>;
  onChange: (next: string) => void;
  onCleanup: (action: CleanupAction) => void;
  onRestoreOriginal: () => void;
  onRetryOtherEngine?: (engine: EngineChoice) => void;
  subMode: EditSubMode;
  onSubModeChange: (mode: EditSubMode) => void;
  syncScroll: boolean;
  onSyncScrollChange: (v: boolean) => void;
  dark: boolean;
  typography: ReaderTypography;
  config?: ServerConfig;
  taskId?: string;
  onAnalyzeAsset?: (assetFilename: string) => Promise<void>;
}

const editorThemeExtension = EditorView.theme({
  "&": {
    fontSize: "13.5px",
    backgroundColor: "transparent !important",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily:
      '"SF Mono", ui-monospace, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
    lineHeight: "1.7",
    padding: "16px 8px",
  },
  ".cm-gutters": {
    backgroundColor: "transparent !important",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    paddingRight: "6px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent !important",
    color: "var(--foreground)",
    fontWeight: "600",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--primary) 6%, transparent) !important",
  },
  ".cm-content": {
    caretColor: "var(--primary)",
    padding: "0 12px",
  },
});

export function MarkdownEditor({
  value,
  originalValue,
  engineUsed,
  engineResults,
  onChange,
  onCleanup,
  onRestoreOriginal,
  onRetryOtherEngine,
  subMode,
  onSubModeChange,
  syncScroll,
  onSyncScrollChange,
  dark,
  typography,
  config,
  taskId,
  onAnalyzeAsset,
}: MarkdownEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const splitPreviewRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<{ source: "editor" | "preview" | null; until: number }>({
    source: null,
    until: 0,
  });

  const [diffMode, setDiffMode] = useState<DiffMode>("original");
  const hasBothEngines = Boolean(engineResults?.markitdown && engineResults?.docling);
  const missingEngine: EngineChoice =
    engineUsed === "docling" || engineResults?.docling ? "markitdown" : "docling";

  const extensions = useMemo(
    () => [markdownLang(), EditorView.lineWrapping, editorThemeExtension],
    [],
  );

  const toc = useMemo(() => extractToc(value), [value]);

  // Bidirectional synchronized scrolling (heading anchor + proportional ratio)
  useEffect(() => {
    if (subMode !== "split" || !syncScroll) return;

    const previewEl = splitPreviewRef.current;
    const view = cmRef.current?.view;
    const editorScroller = view?.scrollDOM;
    if (!previewEl || !editorScroller || !view) return;

    const getAnchors = () => {
      const anchors: { editorTop: number; previewTop: number }[] = [
        { editorTop: 0, previewTop: 0 },
      ];
      const totalLines = view.state.doc.lines;
      for (const item of toc) {
        if (item.line < 1 || item.line > totalLines) continue;
        const headingEl = previewEl.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
        if (!headingEl) continue;
        try {
          const lineInfo = view.state.doc.line(item.line);
          const block = view.lineBlockAt(lineInfo.from);
          anchors.push({
            editorTop: block.top,
            previewTop: headingEl.offsetTop,
          });
        } catch {
          // ignore transient doc mismatch
        }
      }
      anchors.push({
        editorTop: Math.max(1, editorScroller.scrollHeight - editorScroller.clientHeight),
        previewTop: Math.max(1, previewEl.scrollHeight - previewEl.clientHeight),
      });
      return anchors;
    };

    const mapScroll = (
      pos: number,
      fromKey: "editorTop" | "previewTop",
      toKey: "editorTop" | "previewTop",
    ) => {
      const anchors = getAnchors();
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        if (pos >= a[fromKey] && pos <= b[fromKey]) {
          const span = Math.max(1, b[fromKey] - a[fromKey]);
          const ratio = (pos - a[fromKey]) / span;
          return a[toKey] + ratio * (b[toKey] - a[toKey]);
        }
      }
      const last = anchors[anchors.length - 1];
      return last[toKey];
    };

    const onEditorScroll = () => {
      const now = performance.now();
      if (scrollLockRef.current.source === "preview" && now < scrollLockRef.current.until) return;
      scrollLockRef.current = { source: "editor", until: now + 140 };
      const target = mapScroll(editorScroller.scrollTop, "editorTop", "previewTop");
      previewEl.scrollTop = target;
    };

    const onPreviewScroll = () => {
      const now = performance.now();
      if (scrollLockRef.current.source === "editor" && now < scrollLockRef.current.until) return;
      scrollLockRef.current = { source: "preview", until: now + 140 };
      const target = mapScroll(previewEl.scrollTop, "previewTop", "editorTop");
      editorScroller.scrollTop = target;
    };

    editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
    previewEl.addEventListener("scroll", onPreviewScroll, { passive: true });
    return () => {
      editorScroller.removeEventListener("scroll", onEditorScroll);
      previewEl.removeEventListener("scroll", onPreviewScroll);
    };
  }, [subMode, syncScroll, toc, value]);

  const insertSnippet = (prefix: string, suffix = "", placeholder = "文本") => {
    const view = cmRef.current?.view;
    if (!view) {
      onChange(`${value}${prefix}${placeholder}${suffix}`);
      return;
    }
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || placeholder;
    const replacement = `${prefix}${selected}${suffix}`;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: {
        anchor: from + prefix.length,
        head: from + prefix.length + selected.length,
      },
    });
    view.focus();
  };

  const insertBlock = (snippet: string) => {
    const view = cmRef.current?.view;
    if (!view) {
      onChange(`${value}\n\n${snippet}\n`);
      return;
    }
    const { from, to } = view.state.selection.main;
    const prefix = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n\n" : "";
    const text = `${prefix}${snippet}\n`;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  };

  const diffPair = useMemo(() => {
    if (diffMode === "engine_ab" && hasBothEngines) {
      return {
        leftLabel: "MarkItDown",
        rightLabel: "Docling",
        left: engineResults!.markitdown,
        right: engineResults!.docling,
      };
    }
    return {
      leftLabel: "初始转换版本",
      rightLabel: "当前编辑内容",
      left: originalValue ?? value,
      right: value,
    };
  }, [diffMode, hasBothEngines, engineResults, originalValue, value]);

  const diffLines = useMemo(() => {
    if (subMode !== "diff") return [];
    if (diffMode === "engine_ab" && !hasBothEngines) return [];
    return computeLineDiff(diffPair.left, diffPair.right);
  }, [subMode, diffMode, hasBothEngines, diffPair]);

  const diffSummary = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const d of diffLines) {
      if (d.type === "added") added++;
      if (d.type === "removed") removed++;
    }
    return { added, removed };
  }, [diffLines]);

  const formatTools = [
    { icon: Heading1, label: "一级标题", run: () => insertSnippet("# ", "", "标题 1") },
    { icon: Heading2, label: "二级标题", run: () => insertSnippet("## ", "", "标题 2") },
    { icon: Heading3, label: "三级标题", run: () => insertSnippet("### ", "", "标题 3") },
    { icon: Bold, label: "加粗", run: () => insertSnippet("**", "**", "加粗文本") },
    { icon: Italic, label: "斜体", run: () => insertSnippet("*", "*", "斜体文本") },
    { icon: Code, label: "行内代码", run: () => insertSnippet("`", "`", "code") },
    { icon: Quote, label: "引用块", run: () => insertSnippet("> ", "", "引用内容") },
    { icon: List, label: "无序列表", run: () => insertSnippet("- ", "", "列表项") },
    { icon: ListChecks, label: "任务列表", run: () => insertSnippet("- [ ] ", "", "待办事项") },
    {
      icon: Link2,
      label: "插入链接",
      run: () => insertSnippet("[", "](https://example.com)", "链接文字"),
    },
    {
      icon: Table,
      label: "插入表格",
      run: () =>
        insertBlock(
          "| 列名 1 | 列名 2 | 列名 3 |\n| :--- | :--- | :--- |\n| 内容 A | 内容 B | 内容 C |",
        ),
    },
    {
      icon: Sigma,
      label: "插入 LaTeX 公式块",
      run: () => insertBlock("$$\nE = mc^2\n$$"),
    },
    {
      icon: Minus,
      label: "插入分割线",
      run: () => insertBlock("---"),
    },
  ];

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 bg-card">
      {/* Editor formatting & submode bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-toolbar/70 px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          {formatTools.map((tool, idx) => {
            const Icon = tool.icon;
            return (
              <Tooltip key={idx}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={tool.run}
                    disabled={subMode === "diff"}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tool.label}</TooltipContent>
              </Tooltip>
            );
          })}

          <div className="mx-1.5 h-4 w-px bg-border" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="xs" className="gap-1 text-primary">
                <Sparkles className="h-3 w-3" />
                <span>排版精修</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Markdown 智能后处理</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onCleanup("smart_all")}>
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>一键智能精修（推荐）</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onCleanup("merge_pdf_broken_lines")}>
                <span>修复 PDF 跨行断句</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCleanup("collapse_blank_lines")}>
                <span>压缩多余空行</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCleanup("normalize_headings")}>
                <span>规范化标题层级</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCleanup("cjk_spacing")}>
                <span>中英文与数字间距优化</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCleanup("format_tables")}>
                <span>GFM 表格列宽对齐</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCleanup("strip_artifacts")}>
                <span>清除残留图片占位符</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRestoreOriginal}>
                <RotateCcw className="h-3.5 w-3.5" />
                <span>还原为初始转换结果</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right controls: Sync Scroll toggle + Sub-mode segmented control */}
        <div className="flex items-center gap-2">
          {subMode === "split" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={syncScroll ? "subtle" : "ghost"}
                  size="xs"
                  onClick={() => onSyncScrollChange(!syncScroll)}
                  className={cn("gap-1", syncScroll && "text-primary")}
                >
                  {syncScroll ? (
                    <Link2 className="h-3 w-3" />
                  ) : (
                    <Unlink2 className="h-3 w-3" />
                  )}
                  <span className="hidden sm:inline">同步滚动</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {syncScroll ? "已开启双栏标题锚点同步滚动" : "点击开启双栏双向同步滚动"}
              </TooltipContent>
            </Tooltip>
          )}

          <div className="inline-flex items-center rounded-lg bg-secondary p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onSubModeChange("split")}
              className={cn(
                "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 font-medium transition-all",
                subMode === "split"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span>双栏同步</span>
            </button>
            <button
              type="button"
              onClick={() => onSubModeChange("editor")}
              className={cn(
                "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 font-medium transition-all",
                subMode === "editor"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileCode2 className="h-3.5 w-3.5" />
              <span>纯源码</span>
            </button>
            <button
              type="button"
              onClick={() => onSubModeChange("diff")}
              className={cn(
                "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 font-medium transition-all",
                subMode === "diff"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Diff className="h-3.5 w-3.5" />
              <span>修订 / A/B 对比</span>
            </button>
          </div>
        </div>
      </div>

      {/* Editor Body */}
      {subMode === "diff" ? (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex rounded-lg bg-secondary p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setDiffMode("original")}
                  className={cn(
                    "rounded-[5px] px-2 py-0.5 font-medium transition-all",
                    diffMode === "original"
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  对比初始版本
                </button>
                <button
                  type="button"
                  onClick={() => setDiffMode("engine_ab")}
                  className={cn(
                    "rounded-[5px] px-2 py-0.5 font-medium transition-all",
                    diffMode === "engine_ab"
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  双引擎 A/B (MarkItDown vs Docling)
                </button>
              </div>

              {(diffMode === "original" || hasBothEngines) && (
                <>
                  <span className="rounded-full bg-success/14 px-2 py-0.5 font-mono text-[11px] text-success">
                    +{diffSummary.added} 行 ({diffPair.rightLabel})
                  </span>
                  <span className="rounded-full bg-destructive/14 px-2 py-0.5 font-mono text-[11px] text-destructive">
                    -{diffSummary.removed} 行 ({diffPair.leftLabel})
                  </span>
                </>
              )}
            </div>

            {diffMode === "original" ? (
              <Button
                variant="secondary"
                size="xs"
                onClick={onRestoreOriginal}
                disabled={diffSummary.added === 0 && diffSummary.removed === 0}
              >
                <RotateCcw className="h-3 w-3" />
                <span>放弃修改并还原初始结果</span>
              </Button>
            ) : hasBothEngines ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onChange(engineResults!.markitdown)}
                >
                  <span>采用 MarkItDown 版本</span>
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onChange(engineResults!.docling)}
                >
                  <span>采用 Docling 版本</span>
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto font-mono text-xs leading-6">
            {diffMode === "engine_ab" && !hasBothEngines ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground font-sans">
                <Cpu className="h-9 w-9 text-primary opacity-70" />
                <div className="space-y-1 max-w-sm">
                  <p className="text-sm font-semibold text-foreground">
                    尚未生成双引擎 A/B 对比快照
                  </p>
                  <p className="text-xs leading-relaxed">
                    当前仅保留了 <strong className="text-foreground">{engineUsed || "单一引擎"}</strong>{" "}
                    的解析快照。使用另一引擎重新解析一次，系统会自动保留两份快照供你逐行对比与一键择优。
                  </p>
                </div>
                {onRetryOtherEngine && (
                  <Button size="sm" onClick={() => onRetryOtherEngine(missingEngine)}>
                    <Cpu className="h-3.5 w-3.5" />
                    <span>
                      立即用 {missingEngine === "docling" ? "Docling" : "MarkItDown"} 解析并生成对比
                    </span>
                  </Button>
                )}
              </div>
            ) : diffSummary.added === 0 && diffSummary.removed === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground font-sans">
                <Diff className="h-8 w-8 opacity-40" />
                <p className="text-sm font-medium text-foreground">
                  {diffPair.leftLabel} 与 {diffPair.rightLabel} 内容完全一致
                </p>
                <p className="text-xs">在编辑器中修改或运行「排版精修」后，可在此逐行查看修订差异</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {diffLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start px-4 py-0.5 whitespace-pre-wrap break-all",
                      line.type === "added" && "bg-success/12 text-foreground",
                      line.type === "removed" && "bg-destructive/12 text-muted-foreground line-through",
                    )}
                  >
                    <span className="w-10 shrink-0 select-none text-right pr-3 text-[11px] text-muted-foreground/70">
                      {line.oldLine ?? ""}
                    </span>
                    <span className="w-10 shrink-0 select-none text-right pr-3 text-[11px] text-muted-foreground/70">
                      {line.newLine ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-5 shrink-0 select-none font-bold",
                        line.type === "added" && "text-success",
                        line.type === "removed" && "text-destructive",
                      )}
                    >
                      {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                    </span>
                    <span className="flex-1">{line.text || " "}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-1 min-h-0 min-w-0 flex-col md:flex-row",
            subMode === "split" && "divide-y md:divide-y-0 md:divide-x divide-border",
          )}
        >
          <div className="cm-theme-root flex-1 min-h-[240px] min-w-0 overflow-hidden bg-card">
            <CodeMirror
              ref={cmRef}
              value={value}
              height="100%"
              theme={dark ? "dark" : "light"}
              extensions={extensions}
              onChange={(val) => onChange(val)}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                bracketMatching: true,
                history: true,
                searchKeymap: true,
              }}
            />
          </div>

          {subMode === "split" && (
            <div
              ref={splitPreviewRef}
              className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-background px-5 py-6 md:px-7"
            >
              <MarkdownPreview
                markdown={value}
                typography={typography}
                config={config}
                taskId={taskId}
                onAnalyzeAsset={onAnalyzeAsset}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MarkdownEditor;
