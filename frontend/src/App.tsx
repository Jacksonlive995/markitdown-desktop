import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  Archive,
  Check,
  ChevronDown,
  Code2,
  Command as CommandIcon,
  Copy,
  Cpu,
  Download,
  Eye,
  FileCode2,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pin,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SplitSquareHorizontal,
  Sun,
  Trash2,
} from "lucide-react";
import {
  batchDeleteTasks,
  convertTextSnippet,
  deleteTask,
  downloadExportZip,
  downloadLocalHtml,
  downloadLocalMarkdown,
  downloadLocalTxt,
  fetchHealth,
  getTask,
  listTasks,
  printDocumentAsPdf,
  retryTask,
  updateTaskMarkdown,
  updateTaskMeta,
  uploadFile,
} from "./api";
import { CommandPalette } from "./components/CommandPalette";
import { ConvertHub } from "./components/ConvertHub";
import { InspectorPanel } from "./components/InspectorPanel";
import { getFileTypeVisual, LibrarySidebar } from "./components/LibrarySidebar";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { SettingsModal } from "./components/SettingsModal";
import { SourceViewer } from "./components/SourceViewer";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { useUiStore } from "./stores/ui-store";
import type {
  CleanupAction,
  ConversionTask,
  EngineChoice,
  HealthResponse,
  WorkspaceMode,
} from "./types";
import {
  analyzeMarkdown,
  applyMarkdownCleanup,
  extractToc,
  formatBytes,
  formatDuration,
  SAMPLE_SHOWCASE_MARKDOWN,
  stripMarkdownToPlainText,
} from "./utils/markdown";
import { cn, isMac } from "./lib/utils";

export default function App() {
  const {
    config,
    setConfig,
    setTypography,
    engine,
    setEngine,
    sidebarCollapsed,
    setSidebarCollapsed,
    inspectorOpen,
    setInspectorOpen,
    inspectorTab,
    setInspectorTab,
    mobileInspectorOpen,
    setMobileInspectorOpen,
    workspaceMode,
    setWorkspaceMode,
    editSubMode,
    setEditSubMode,
    mobileTab,
    setMobileTab,
    settingsOpen,
    setSettingsOpen,
    commandOpen,
    setCommandOpen,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    sortField,
    setSortField,
    batchMode,
    setBatchMode,
    selectedTaskIds,
    toggleBatchSelect,
    setSelectedTaskIds,
    activeHeadingId,
    setActiveHeadingId,
  } = useUiStore();

  const [systemDark, setSystemDark] = useState<boolean>(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthOnline, setHealthOnline] = useState<boolean>(false);

  const [tasks, setTasks] = useState<ConversionTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ConversionTask | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proofreadRightMode, setProofreadRightMode] = useState<"preview" | "edit">("preview");
  const [sourceWidthPct, setSourceWidthPct] = useState(46);

  const previewArticleRef = useRef<HTMLElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const compareContainerRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);

  // Listen to OS dark mode changes
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const effectiveDark =
    config.theme === "system" ? systemDark : config.theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", effectiveDark);
    document.documentElement.setAttribute(
      "data-theme",
      effectiveDark ? "dark" : "light",
    );
  }, [effectiveDark]);

  // Refresh server health & tasks when committed config changes
  const refreshServer = useCallback(
    async (silent = false) => {
      try {
        const h = await fetchHealth(config);
        setHealth(h);
        setHealthOnline(true);
        const list = await listTasks(config);
        setTasks(list);
      } catch (err) {
        setHealth(null);
        setHealthOnline(false);
        if (!silent) {
          toast.error(
            err instanceof Error ? err.message : "无法连接到后端服务，请检查设置中的服务地址",
          );
        }
      }
    },
    [config],
  );

  useEffect(() => {
    refreshServer(true);
  }, [refreshServer]);

  // Poll pending tasks
  useEffect(() => {
    const hasPending = tasks.some(
      (t) => t.status === "queued" || t.status === "processing",
    );
    if (!hasPending) return;

    const timer = window.setInterval(async () => {
      try {
        const list = await listTasks(config);
        setTasks(list);
        if (selectedId) {
          const detail = await getTask(config, selectedId);
          setSelectedTask(detail);
          if (detail.status === "completed" && !dirty) {
            setDraftMarkdown(detail.markdown ?? "");
          }
        }
      } catch {
        // ignore transient polling error
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [tasks, config, selectedId, dirty]);

  // Load selected task details
  useEffect(() => {
    if (!selectedId) {
      setSelectedTask(null);
      setDraftMarkdown("");
      setDirty(false);
      return;
    }
    let cancelled = false;
    getTask(config, selectedId)
      .then((detail) => {
        if (cancelled) return;
        setSelectedTask(detail);
        setDraftMarkdown(detail.markdown ?? "");
        setDirty(false);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "加载任务详情失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedId]);

  // Save markdown handler
  const handleSaveMarkdown = useCallback(
    async (silent = false) => {
      if (!selectedTask || selectedTask.status !== "completed" || !dirty) return;
      setSaving(true);
      try {
        const updated = await updateTaskMarkdown(
          config,
          selectedTask.task_id,
          draftMarkdown,
        );
        setSelectedTask(updated);
        setTasks((prev) =>
          prev.map((t) =>
            t.task_id === updated.task_id
              ? {
                  ...t,
                  markdown_length: updated.markdown_length,
                  edited: updated.edited,
                }
              : t,
          ),
        );
        setDirty(false);
        if (!silent) toast.success("文档修改已保存");
      } catch (err) {
        if (!silent) {
          toast.error(err instanceof Error ? err.message : "保存失败");
        }
      } finally {
        setSaving(false);
      }
    },
    [selectedTask, dirty, config, draftMarkdown],
  );

  // Auto-save debounce (1.5s)
  useEffect(() => {
    if (!config.autoSave || !dirty || !selectedTask || selectedTask.status !== "completed") {
      return;
    }
    const timer = window.setTimeout(() => {
      handleSaveMarkdown(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [config.autoSave, dirty, draftMarkdown, selectedTask, handleSaveMarkdown]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveMarkdown(false);
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      } else if (mod && e.key === "1" && selectedTask) {
        e.preventDefault();
        setWorkspaceMode("read");
      } else if (mod && e.key === "2" && selectedTask) {
        e.preventDefault();
        setWorkspaceMode("edit");
      } else if (mod && e.key === "3" && selectedTask) {
        e.preventDefault();
        setWorkspaceMode("proofread");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleSaveMarkdown,
    selectedTask,
    setCommandOpen,
    setSidebarCollapsed,
    setWorkspaceMode,
  ]);

  // Split resizer mouse events for Proofread mode
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current || !compareContainerRef.current) return;
      const rect = compareContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSourceWidthPct(Math.min(72, Math.max(25, pct)));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const toc = useMemo(() => extractToc(draftMarkdown), [draftMarkdown]);
  const stats = useMemo(() => analyzeMarkdown(draftMarkdown), [draftMarkdown]);

  // Scroll spy for TOC active heading
  useEffect(() => {
    const container = previewScrollRef.current;
    if (!container || toc.length === 0) return;

    const onScroll = () => {
      const scrollTop = container.scrollTop;
      let currentId = toc[0]?.id ?? null;
      for (const item of toc) {
        const el = document.getElementById(item.id);
        if (el && el.offsetTop - 80 <= scrollTop) {
          currentId = item.id;
        }
      }
      setActiveHeadingId(currentId);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [toc, setActiveHeadingId, workspaceMode]);

  const scrollToHeading = (headingId: string) => {
    const el = document.getElementById(headingId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveHeadingId(headingId);
      setMobileInspectorOpen(false);
    }
  };

  // File upload handler
  const handleUploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      let lastId: string | null = null;
      for (const file of arr) {
        const created = await uploadFile(config, file, engine);
        lastId = created.task_id;
      }
      const list = await listTasks(config);
      setTasks(list);
      toast.success(
        arr.length === 1
          ? `已提交「${arr[0].name}」进行解析`
          : `已批量提交 ${arr.length} 个文档进入解析队列`,
      );
      if (lastId) {
        setSelectedId(lastId);
        setWorkspaceMode("read");
        setMobileTab("workspace");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  // Snippet conversion handler
  const handleConvertSnippet = async (payload: {
    title: string;
    content: string;
    format: "html" | "txt" | "csv" | "json";
  }) => {
    try {
      const created = await convertTextSnippet(config, {
        ...payload,
        engine: "markitdown",
      });
      const list = await listTasks(config);
      setTasks(list);
      setSelectedId(created.task_id);
      setWorkspaceMode("read");
      setMobileTab("workspace");
      toast.success(`已创建「${created.filename}」转换任务`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "片段转换失败");
    }
  };

  // Load showcase academic sample
  const handleLoadSample = async () => {
    try {
      const created = await convertTextSnippet(config, {
        title: "深度学习文档版面解析研究报告",
        content: SAMPLE_SHOWCASE_MARKDOWN,
        format: "md",
        engine: "markitdown",
      });
      const list = await listTasks(config);
      setTasks(list);
      setSelectedId(created.task_id);
      setWorkspaceMode("read");
      setMobileTab("workspace");
      toast.success("已载入示例学术报告，可自由体验阅读排版、编辑、Diff 与清洗工具");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "载入示例失败，请确认后端服务已启动");
    }
  };

  const handleSelectTask = (taskId: string) => {
    if (dirty && !config.autoSave) {
      handleSaveMarkdown(true);
    }
    setSelectedId(taskId);
    setMobileTab("workspace");
  };

  const handleOpenConvertHub = () => {
    setSelectedId(null);
    setMobileTab("hub");
  };

  const handleTogglePin = async (task: ConversionTask) => {
    try {
      const updated = await updateTaskMeta(config, task.task_id, {
        pinned: !task.pinned,
      });
      setTasks((prev) =>
        prev.map((t) => (t.task_id === task.task_id ? { ...t, pinned: updated.pinned } : t)),
      );
      if (selectedTask?.task_id === task.task_id) {
        setSelectedTask((prev) => (prev ? { ...prev, pinned: updated.pinned } : prev));
      }
      toast.success(updated.pinned ? "已星标置顶该文档" : "已取消星标置顶");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleRenameTask = async (taskId: string, newName: string) => {
    try {
      const updated = await updateTaskMeta(config, taskId, { filename: newName });
      setTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, filename: updated.filename } : t)),
      );
      if (selectedTask?.task_id === taskId) {
        setSelectedTask((prev) => (prev ? { ...prev, filename: updated.filename } : prev));
      }
      toast.success("已重命名文档");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败");
    }
  };

  const handleRetryTask = async (taskId: string, overrideEngine?: EngineChoice) => {
    try {
      const updated = await retryTask(config, taskId, overrideEngine);
      setTasks((prev) => prev.map((t) => (t.task_id === taskId ? updated : t)));
      if (selectedId === taskId) {
        setSelectedTask(updated);
        setDirty(false);
      }
      toast.success(
        `已使用 ${overrideEngine || updated.engine_requested} 引擎重新加入解析队列`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重新解析失败");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(config, taskId);
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
      if (selectedId === taskId) {
        setSelectedId(null);
      }
      toast.success("已删除该文档");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleBatchDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const deleted = await batchDeleteTasks(config, ids);
      setTasks((prev) => prev.filter((t) => !deleted.includes(t.task_id)));
      if (selectedId && deleted.includes(selectedId)) {
        setSelectedId(null);
      }
      setSelectedTaskIds([]);
      setBatchMode(false);
      toast.success(`已批量删除 ${deleted.length} 个文档`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量删除失败");
    }
  };

  const handleBatchExportZip = async (ids?: string[]) => {
    try {
      await downloadExportZip(config, ids && ids.length > 0 ? ids : undefined);
      toast.success("已打包下载 ZIP 归档");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量导出失败");
    }
  };

  const handleCleanup = (action: CleanupAction) => {
    const { result, summary } = applyMarkdownCleanup(draftMarkdown, action);
    if (result !== draftMarkdown) {
      setDraftMarkdown(result);
      setDirty(true);
      toast.success(summary);
    } else {
      toast.info("当前文档格式已经非常整洁，无需调整");
    }
  };

  const handleRestoreOriginal = () => {
    if (!selectedTask) return;
    const orig = selectedTask.original_markdown ?? selectedTask.markdown ?? "";
    setDraftMarkdown(orig);
    setDirty(true);
    toast.success("已还原为初始转换结果");
  };

  // Copy & Export Helpers
  const handleCopyMarkdown = async () => {
    if (!draftMarkdown) return;
    await navigator.clipboard.writeText(draftMarkdown);
    toast.success("已复制 Markdown 源码到剪贴板");
  };

  const handleCopyPlainText = async () => {
    if (!draftMarkdown) return;
    const plain = stripMarkdownToPlainText(draftMarkdown);
    await navigator.clipboard.writeText(plain);
    toast.success("已复制纯文本到剪贴板");
  };

  const handleCopyRichHtml = async () => {
    const htmlEl = previewArticleRef.current;
    if (!htmlEl) {
      await handleCopyMarkdown();
      return;
    }
    try {
      const html = htmlEl.innerHTML;
      const plain = stripMarkdownToPlainText(draftMarkdown);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
        toast.success("已复制富文本格式（可直接粘贴至飞书 / Notion / Word）");
        return;
      }
      await navigator.clipboard.writeText(html);
      toast.success("已复制 HTML 内容");
    } catch {
      await handleCopyMarkdown();
    }
  };

  const handleExportMd = () => {
    if (!selectedTask) return;
    downloadLocalMarkdown(draftMarkdown, selectedTask.filename, selectedTask.task_id);
    toast.success("已导出 .md 文件");
  };

  const handleExportHtml = () => {
    if (!selectedTask) return;
    const htmlBody =
      previewArticleRef.current?.innerHTML ||
      `<pre>${draftMarkdown.replace(/</g, "&lt;")}</pre>`;
    downloadLocalHtml(htmlBody, selectedTask.filename, selectedTask.task_id);
    toast.success("已导出独立排版 .html 网页");
  };

  const handleExportTxt = () => {
    if (!selectedTask) return;
    const plain = stripMarkdownToPlainText(draftMarkdown);
    downloadLocalTxt(plain, selectedTask.filename, selectedTask.task_id);
    toast.success("已导出 .txt 纯文本");
  };

  const handlePrintPdf = () => {
    if (!selectedTask) return;
    const htmlBody =
      previewArticleRef.current?.innerHTML ||
      `<pre>${draftMarkdown.replace(/</g, "&lt;")}</pre>`;
    printDocumentAsPdf(htmlBody, selectedTask.filename);
  };

  const handleDownloadTaskFromSidebar = async (task: ConversionTask) => {
    try {
      const detail =
        selectedTask?.task_id === task.task_id
          ? { ...selectedTask, markdown: draftMarkdown }
          : await getTask(config, task.task_id);
      downloadLocalMarkdown(detail.markdown ?? "", detail.filename, detail.task_id);
      toast.success(`已导出 ${detail.filename}.md`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    }
  };

  const toggleQuickTheme = () => {
    const next = effectiveDark ? "light" : "dark";
    setConfig((prev) => ({ ...prev, theme: next }));
  };

  const switchWorkspaceMode = (mode: WorkspaceMode) => {
    setWorkspaceMode(mode);
    if (mode === "proofread") {
      setSidebarCollapsed(true);
    }
  };

  const completedCount = useMemo(
    () => tasks.filter((t) => t.status === "completed").length,
    [tasks],
  );

  return (
    <TooltipProvider delayDuration={220}>
      <div className="flex h-full flex-col bg-background text-foreground safe-top">
        <Toaster
          position="bottom-right"
          theme={effectiveDark ? "dark" : "light"}
          richColors
          closeButton
        />

        {/* ============================================================ */}
        {/* Unified Cupertino Titlebar / Toolbar                         */}
        {/* ============================================================ */}
        <header className="z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-toolbar glass px-3 sm:px-4">
          {/* Left: Sidebar toggle + Brand + Active Document Title */}
          <div className="flex items-center gap-2 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hidden md:inline-flex"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {sidebarCollapsed ? "展开文档库侧栏" : "收起文档库侧栏"} ({isMac ? "⌘B" : "Ctrl+B"})
              </TooltipContent>
            </Tooltip>

            <button
              type="button"
              onClick={handleOpenConvertHub}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-accent"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-[#5856d6] text-xs font-bold text-white shadow-2xs">
                M
              </div>
              <span className="hidden text-[13px] font-semibold tracking-tight sm:inline">
                MarkItDown
              </span>
            </button>

            {selectedTask && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="truncate max-w-[140px] sm:max-w-[260px] text-[13px] font-semibold text-foreground"
                    title={selectedTask.filename}
                  >
                    {selectedTask.filename}
                  </span>
                  {dirty ? (
                    <Badge variant="warning" className="hidden sm:inline-flex">
                      未保存
                    </Badge>
                  ) : selectedTask.edited ? (
                    <Badge variant="secondary" className="hidden sm:inline-flex">
                      已微调
                    </Badge>
                  ) : null}
                </div>
              </>
            )}
          </div>

          {/* Center: 3-Mode Workspace Segmented Switcher (Read / Edit / Proofread) */}
          {selectedTask && selectedTask.status === "completed" && (
            <div className="inline-flex items-center rounded-xl bg-secondary p-0.5 text-xs shadow-2xs">
              {(
                [
                  ["read", "阅读", Eye],
                  ["edit", "编辑", Code2],
                  ["proofread", "校对", SplitSquareHorizontal],
                ] as const
              ).map(([modeKey, label, Icon]) => (
                <button
                  key={modeKey}
                  type="button"
                  onClick={() => switchWorkspaceMode(modeKey)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[9px] px-2.5 sm:px-3 py-1 font-medium transition-all",
                    workspaceMode === modeKey
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Right: Command Palette + Save + Consolidated Export Menu + Inspector Toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCommandOpen(true)}
              className="hidden lg:inline-flex gap-2 text-muted-foreground h-7.5 px-2.5"
            >
              <CommandIcon className="h-3.5 w-3.5" />
              <span className="text-xs">命令面板</span>
              <kbd className="rounded bg-muted px-1.5 py-0.2 font-mono text-[10px]">
                {isMac ? "⌘K" : "Ctrl+K"}
              </kbd>
            </Button>

            {selectedTask && selectedTask.status === "completed" && (
              <>
                {dirty && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSaveMarkdown(false)}
                    disabled={saving}
                    className="h-7.5"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5 text-primary" />
                    )}
                    <span className="hidden sm:inline">保存</span>
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyMarkdown}
                  className="hidden sm:inline-flex h-7.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>复制</span>
                </Button>

                {/* Consolidated Export Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="h-7.5 gap-1">
                      <Download className="h-3.5 w-3.5" />
                      <span>导出</span>
                      <ChevronDown className="h-3 w-3 opacity-80" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>导出当前文档</DropdownMenuLabel>
                    <DropdownMenuItem onClick={handleExportMd}>
                      <Download className="h-3.5 w-3.5" />
                      <span>导出 Markdown (.md)</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportHtml}>
                      <FileCode2 className="h-3.5 w-3.5" />
                      <span>导出独立网页 (.html)</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportTxt}>
                      <FileText className="h-3.5 w-3.5" />
                      <span>导出纯文本 (.txt)</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePrintPdf}>
                      <Printer className="h-3.5 w-3.5" />
                      <span>打印 / 导出 PDF (.pdf)</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>复制到剪贴板</DropdownMenuLabel>
                    <DropdownMenuItem onClick={handleCopyMarkdown}>
                      <Copy className="h-3.5 w-3.5" />
                      <span>复制 Markdown 源码</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleCopyRichHtml}>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>复制为富文本 (飞书/Notion/Word)</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleCopyPlainText}>
                      <FileText className="h-3.5 w-3.5" />
                      <span>复制为纯文本</span>
                    </DropdownMenuItem>
                    {completedCount > 1 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleBatchExportZip()}>
                          <Archive className="h-3.5 w-3.5" />
                          <span>打包全部已完成文档 (.zip)</span>
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Document More Actions Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => handleTogglePin(selectedTask)}>
                      <Pin className="h-3.5 w-3.5" />
                      <span>{selectedTask.pinned ? "取消星标置顶" : "星标置顶文档"}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCleanup("smart_all")}>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>一键智能排版精修</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleRestoreOriginal}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>还原为初始转换结果</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleRetryTask(selectedTask.task_id, "markitdown")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>改用 MarkItDown 重转</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleRetryTask(selectedTask.task_id, "docling")}
                    >
                      <Cpu className="h-3.5 w-3.5" />
                      <span>改用 Docling 重转</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onClick={() => handleDeleteTask(selectedTask.task_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>删除此文档</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleQuickTheme}
              title="切换浅色 / 深色外观"
            >
              {effectiveDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSettingsOpen(true)}
              title="服务部署与偏好设置"
            >
              <Settings className="h-4 w-4" />
            </Button>

            {selectedTask && selectedTask.status === "completed" && (
              <>
                {/* Desktop Inspector Toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={inspectorOpen ? "subtle" : "ghost"}
                      size="icon-sm"
                      className="hidden xl:inline-flex"
                      onClick={() => setInspectorOpen((v) => !v)}
                    >
                      <PanelRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {inspectorOpen ? "收起右侧检查器" : "展开右侧检查器（目录/属性/排版）"}
                  </TooltipContent>
                </Tooltip>

                {/* Mobile/Tablet Inspector Trigger */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="xl:hidden"
                  onClick={() => setMobileInspectorOpen(true)}
                  title="打开目录与排版面板"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </header>

        {/* ============================================================ */}
        {/* Main 3-Pane Workspace                                        */}
        {/* ============================================================ */}
        <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          {/* Left Library Sidebar (Desktop persistent, Mobile visible on 'library' tab) */}
          {!sidebarCollapsed && (
            <LibrarySidebar
              tasks={tasks}
              selectedId={selectedId}
              onSelectTask={handleSelectTask}
              onOpenConvertHub={handleOpenConvertHub}
              onQuickUploadFiles={handleUploadFiles}
              uploading={uploading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              sortField={sortField}
              onSortFieldChange={setSortField}
              batchMode={batchMode}
              onBatchModeChange={setBatchMode}
              selectedTaskIds={selectedTaskIds}
              onToggleBatchSelect={toggleBatchSelect}
              onSelectAllBatch={setSelectedTaskIds}
              onBatchExportZip={handleBatchExportZip}
              onBatchDelete={handleBatchDelete}
              onTogglePin={handleTogglePin}
              onRenameTask={handleRenameTask}
              onRetryTask={handleRetryTask}
              onDeleteTask={handleDeleteTask}
              onDownloadTaskMd={handleDownloadTaskFromSidebar}
              className="hidden md:flex"
            />
          )}

          {/* Mobile Library Full View */}
          {mobileTab === "library" && (
            <LibrarySidebar
              tasks={tasks}
              selectedId={selectedId}
              onSelectTask={handleSelectTask}
              onOpenConvertHub={handleOpenConvertHub}
              onQuickUploadFiles={handleUploadFiles}
              uploading={uploading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              sortField={sortField}
              onSortFieldChange={setSortField}
              batchMode={batchMode}
              onBatchModeChange={setBatchMode}
              selectedTaskIds={selectedTaskIds}
              onToggleBatchSelect={toggleBatchSelect}
              onSelectAllBatch={setSelectedTaskIds}
              onBatchExportZip={handleBatchExportZip}
              onBatchDelete={handleBatchDelete}
              onTogglePin={handleTogglePin}
              onRenameTask={handleRenameTask}
              onRetryTask={handleRetryTask}
              onDeleteTask={handleDeleteTask}
              onDownloadTaskMd={handleDownloadTaskFromSidebar}
              className="flex w-full border-r-0 md:hidden"
            />
          )}

          {/* Center Canvas */}
          <main
            className={cn(
              "flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden",
              mobileTab === "library" && "hidden md:flex",
            )}
          >
            {!selectedTask || mobileTab === "hub" ? (
              <ConvertHub
                engine={engine}
                onEngineChange={setEngine}
                health={health}
                uploading={uploading}
                onUploadFiles={handleUploadFiles}
                onConvertSnippet={handleConvertSnippet}
                onLoadSample={handleLoadSample}
                tasks={tasks}
                onSelectTask={handleSelectTask}
              />
            ) : selectedTask.status === "queued" || selectedTask.status === "processing" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Loader2 className="h-7 w-7 animate-spin" />
                </div>
                <h2 className="text-base font-semibold text-foreground">
                  正在使用 {selectedTask.engine_requested} 解析「{selectedTask.filename}」
                </h2>
                <p className="max-w-md text-xs text-muted-foreground leading-relaxed">
                  扫描件 OCR、跨页复杂表格与学术论文版面分析可能需要数秒至数十秒，完成后将自动在此展示结果
                </p>
              </div>
            ) : selectedTask.status === "failed" ? (
              <div className="flex flex-1 flex-col items-center justify-center p-6">
                <div className="w-full max-w-lg rounded-2xl border border-destructive/30 bg-destructive/10 p-6 space-y-4">
                  <div className="space-y-1">
                    <Badge variant="destructive">转换失败</Badge>
                    <h3 className="text-base font-semibold text-foreground">
                      {selectedTask.filename}
                    </h3>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-xl bg-background/80 p-3 font-mono text-xs text-destructive whitespace-pre-wrap">
                    {selectedTask.error || "未知解析错误"}
                  </pre>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleRetryTask(selectedTask.task_id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>原引擎重试</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRetryTask(selectedTask.task_id, "markitdown")}
                    >
                      <span>改用 MarkItDown 重试</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRetryTask(selectedTask.task_id, "docling")}
                    >
                      <span>改用 Docling 重试</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : workspaceMode === "read" ? (
              /* ======================================================== */
              /* Mode 1: Clean Apple-style Reader                         */
              /* ======================================================== */
              <div
                ref={previewScrollRef}
                className="flex-1 overflow-y-auto px-5 py-7 sm:px-10 sm:py-9"
              >
                {/* Document Header Banner inside Reader */}
                <div
                  style={{
                    maxWidth:
                      config.typography.width === "compact"
                        ? "660px"
                        : config.typography.width === "wide"
                          ? "980px"
                          : "780px",
                  }}
                  className="mx-auto mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-4"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {(() => {
                      const vis = getFileTypeVisual(selectedTask.filename);
                      const Icon = vis.icon;
                      return (
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                            vis.bg,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                      );
                    })()}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {selectedTask.filename}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>引擎：{selectedTask.engine_used || selectedTask.engine_requested}</span>
                        <span>·</span>
                        <span>{formatBytes(selectedTask.file_size)}</span>
                        <span>·</span>
                        <span>耗时 {formatDuration(selectedTask.duration_ms)}</span>
                        <span>·</span>
                        <span>{stats.words.toLocaleString()} 词</span>
                        <span>·</span>
                        <span>约 {stats.readingMinutes} 分钟读完</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => handleCleanup("smart_all")}
                      className="text-primary"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>一键排版精修</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => switchWorkspaceMode("edit")}
                    >
                      <Code2 className="h-3 w-3" />
                      <span>微调源码</span>
                    </Button>
                  </div>
                </div>

                <MarkdownPreview
                  markdown={draftMarkdown}
                  typography={config.typography}
                  articleRef={previewArticleRef}
                />
              </div>
            ) : workspaceMode === "edit" ? (
              /* ======================================================== */
              /* Mode 2: CodeMirror 6 Editor + Live Split / Diff          */
              /* ======================================================== */
              <MarkdownEditor
                value={draftMarkdown}
                originalValue={selectedTask.original_markdown ?? selectedTask.markdown}
                onChange={(next) => {
                  setDraftMarkdown(next);
                  setDirty(true);
                }}
                onCleanup={handleCleanup}
                onRestoreOriginal={handleRestoreOriginal}
                subMode={editSubMode}
                onSubModeChange={setEditSubMode}
                dark={effectiveDark}
                typography={config.typography}
              />
            ) : (
              /* ======================================================== */
              /* Mode 3: Side-by-Side Source Proofread                    */
              /* ======================================================== */
              <div
                ref={compareContainerRef}
                className="flex flex-1 flex-col md:flex-row min-h-0 min-w-0 overflow-hidden"
              >
                <div
                  style={{ flexBasis: `${sourceWidthPct}%` }}
                  className="flex flex-col min-h-[240px] min-w-[260px] shrink-0 overflow-hidden border-b md:border-b-0 border-border"
                >
                  <SourceViewer
                    config={config}
                    taskId={selectedTask.task_id}
                    filename={selectedTask.filename}
                  />
                </div>

                {/* Draggable Resizer */}
                <div
                  title="拖动调节源文件与 Markdown 校对区宽度"
                  onMouseDown={() => {
                    resizingRef.current = true;
                    document.body.style.cursor = "col-resize";
                  }}
                  className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-border/80 transition-colors hover:bg-primary"
                />

                {/* Right Pane in Proofread Mode: Toggleable between Preview & Editor */}
                <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-background">
                  <div className="flex items-center justify-between border-b border-border bg-toolbar/70 px-3.5 py-1.5 text-xs">
                    <span className="font-medium text-muted-foreground">
                      Markdown 校对区
                    </span>
                    <div className="inline-flex rounded-lg bg-secondary p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setProofreadRightMode("preview")}
                        className={cn(
                          "rounded-[6px] px-2.5 py-0.5 font-medium transition-all",
                          proofreadRightMode === "preview"
                            ? "bg-card text-foreground shadow-2xs"
                            : "text-muted-foreground",
                        )}
                      >
                        渲染预览
                      </button>
                      <button
                        type="button"
                        onClick={() => setProofreadRightMode("edit")}
                        className={cn(
                          "rounded-[6px] px-2.5 py-0.5 font-medium transition-all",
                          proofreadRightMode === "edit"
                            ? "bg-card text-foreground shadow-2xs"
                            : "text-muted-foreground",
                        )}
                      >
                        源码微调
                      </button>
                    </div>
                  </div>

                  {proofreadRightMode === "preview" ? (
                    <div className="flex-1 overflow-y-auto px-6 py-6">
                      <MarkdownPreview
                        markdown={draftMarkdown}
                        typography={config.typography}
                        articleRef={previewArticleRef}
                      />
                    </div>
                  ) : (
                    <MarkdownEditor
                      value={draftMarkdown}
                      originalValue={selectedTask.original_markdown ?? selectedTask.markdown}
                      onChange={(next) => {
                        setDraftMarkdown(next);
                        setDirty(true);
                      }}
                      onCleanup={handleCleanup}
                      onRestoreOriginal={handleRestoreOriginal}
                      subMode="editor"
                      onSubModeChange={() => {}}
                      dark={effectiveDark}
                      typography={config.typography}
                    />
                  )}
                </div>
              </div>
            )}
          </main>

          {/* Right Inspector Rail (Desktop XL) */}
          {selectedTask &&
            selectedTask.status === "completed" &&
            inspectorOpen &&
            mobileTab !== "hub" && (
              <InspectorPanel
                tab={inspectorTab}
                onTabChange={setInspectorTab}
                toc={toc}
                activeHeadingId={activeHeadingId}
                onSelectHeading={scrollToHeading}
                stats={stats}
                task={selectedTask}
                typography={config.typography}
                onTypographyChange={setTypography}
                onCleanup={handleCleanup}
                onRestoreOriginal={handleRestoreOriginal}
                onRetryEngine={(eng) => handleRetryTask(selectedTask.task_id, eng)}
                className="hidden xl:flex"
              />
            )}
        </div>

        {/* ============================================================ */}
        {/* Desktop Status Bar                                           */}
        {/* ============================================================ */}
        <footer className="hidden md:flex h-7 shrink-0 items-center justify-between border-t border-border bg-toolbar/80 glass px-3.5 text-[11px] text-muted-foreground select-none">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  healthOnline ? "bg-success" : "bg-destructive",
                )}
              />
              <span className="font-medium">
                {healthOnline
                  ? config.mode === "local"
                    ? "本机服务已连接"
                    : `远程节点 (${config.baseUrl})`
                  : "后端服务未连接"}
              </span>
            </button>

            {health && (
              <>
                <span>·</span>
                <span>
                  引擎：{health.engines.docling ? "MarkItDown + Docling 双引擎就绪" : "MarkItDown 就绪"}
                </span>
              </>
            )}

            <button
              type="button"
              onClick={() => refreshServer(false)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title="刷新任务列表"
            >
              <RefreshCw className="h-3 w-3" />
              <span>刷新</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {selectedTask && selectedTask.status === "completed" && (
              <>
                <span>{stats.words.toLocaleString()} 词</span>
                <span>·</span>
                <span>{stats.chars.toLocaleString()} 字符</span>
                <span>·</span>
                <span>{stats.lines} 行</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  {saving ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      <span>正在同步...</span>
                    </>
                  ) : dirty ? (
                    <span className="text-warning">未保存修改</span>
                  ) : (
                    <>
                      <Check className="h-3 w-3 text-success" />
                      <span>已同步</span>
                    </>
                  )}
                </span>
              </>
            )}
          </div>
        </footer>

        {/* ============================================================ */}
        {/* iOS / Mobile Bottom Tab Bar (with safe-area-inset-bottom)     */}
        {/* ============================================================ */}
        <nav className="grid grid-cols-4 border-t border-border bg-toolbar/90 glass px-2 py-1 safe-bottom md:hidden">
          <button
            type="button"
            onClick={handleOpenConvertHub}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium",
              mobileTab === "hub" || !selectedTask
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            <Layers className="h-4 w-4" />
            <span>转换中心</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab("library")}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium",
              mobileTab === "library" ? "text-primary" : "text-muted-foreground",
            )}
          >
            <FolderOpen className="h-4 w-4" />
            <span>文档库 ({tasks.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!selectedTask && tasks.length > 0) {
                setSelectedId(tasks[0].task_id);
              }
              setMobileTab("workspace");
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium",
              mobileTab === "workspace" && selectedTask
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            <Eye className="h-4 w-4" />
            <span>阅读器</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium text-muted-foreground"
          >
            <Settings className="h-4 w-4" />
            <span>设置</span>
          </button>
        </nav>

        {/* Mobile / Tablet Inspector Sheet Dialog */}
        <Dialog open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
          <DialogContent className="max-w-md p-0 overflow-hidden max-h-[82vh] flex flex-col">
            <DialogHeader className="px-4 pt-4 pb-0">
              <DialogTitle className="text-sm">文档检查器（目录 / 属性 / 排版清洗）</DialogTitle>
            </DialogHeader>
            {selectedTask && (
              <InspectorPanel
                tab={inspectorTab}
                onTabChange={setInspectorTab}
                toc={toc}
                activeHeadingId={activeHeadingId}
                onSelectHeading={scrollToHeading}
                stats={stats}
                task={selectedTask}
                typography={config.typography}
                onTypographyChange={setTypography}
                onCleanup={handleCleanup}
                onRestoreOriginal={handleRestoreOriginal}
                onRetryEngine={(eng) => handleRetryTask(selectedTask.task_id, eng)}
                className="w-full border-l-0 flex-1"
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Command Palette (⌘K / Ctrl+K) */}
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          tasks={tasks}
          selectedTask={selectedTask}
          onSelectTask={handleSelectTask}
          onNewConversion={handleOpenConvertHub}
          onLoadSample={handleLoadSample}
          onSwitchMode={switchWorkspaceMode}
          onCleanup={handleCleanup}
          onCopyMarkdown={handleCopyMarkdown}
          onExportMd={handleExportMd}
          onExportHtml={handleExportHtml}
          onToggleTheme={toggleQuickTheme}
          onOpenSettings={() => setSettingsOpen(true)}
          dark={effectiveDark}
        />

        {/* Settings Modal (Local & Remote Server Profiles + Test Connection) */}
        <SettingsModal
          open={settingsOpen}
          config={config}
          health={health}
          onSave={(next) => {
            setConfig(next);
            setEngine(next.defaultEngine);
            toast.success("设置已保存并应用");
          }}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}
