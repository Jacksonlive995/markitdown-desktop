import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ListTree,
  Loader2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  SplitSquareHorizontal,
  Sun,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  deleteTask,
  downloadExportZip,
  downloadLocalMarkdown,
  fetchHealth,
  getTask,
  listTasks,
  retryTask,
  updateTaskMarkdown,
  uploadFile,
} from "./api";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { SettingsModal } from "./components/SettingsModal";
import { SourceViewer } from "./components/SourceViewer";
import type {
  ConversionTask,
  EngineChoice,
  HealthResponse,
  MobileTab,
  ServerConfig,
  StatusFilter,
  ViewMode,
} from "./types";
import {
  countMarkdownWords,
  extractToc,
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "./utils/markdown";

const STORAGE_KEY = "markitdown_v1_config";

function loadConfig(): ServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        baseUrl: parsed.baseUrl || "http://127.0.0.1:8000",
        token: parsed.token || "",
        defaultEngine: parsed.defaultEngine || "auto",
        theme: parsed.theme || "system",
      };
    }
  } catch {
    // ignore invalid storage
  }
  return {
    baseUrl: "http://127.0.0.1:8000",
    token: "",
    defaultEngine: "auto",
    theme: "system",
  };
}

function getFileIcon(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")) {
    return <FileSpreadsheet size={16} className="file-icon sheet" />;
  }
  if (/\.(png|jpg|jpeg|webp|tif|tiff|bmp)$/.test(lower)) {
    return <ImageIcon size={16} className="file-icon image" />;
  }
  if (lower.endsWith(".pdf")) {
    return <FileText size={16} className="file-icon pdf" />;
  }
  return <FileText size={16} className="file-icon doc" />;
}

export default function App() {
  const [config, setConfig] = useState<ServerConfig>(loadConfig);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("tasks");

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [engine, setEngine] = useState<EngineChoice>(config.defaultEngine);
  const [tasks, setTasks] = useState<ConversionTask[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ConversionTask | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [compareSource, setCompareSource] = useState(false);
  const [sourceWidthPct, setSourceWidthPct] = useState(46);
  const [uploading, setUploading] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const compareContainerRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const effectiveTheme = config.theme === "system" ? (systemDark ? "dark" : "light") : config.theme;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
  }, [effectiveTheme]);

  const refreshServer = async (cfg: ServerConfig) => {
    try {
      const h = await fetchHealth(cfg);
      setHealth(h);
      setHealthError(null);
      const list = await listTasks(cfg);
      setTasks(list);
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : "无法连接到后端服务");
    }
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    refreshServer(config);
  }, [config]);

  useEffect(() => {
    const hasPending = tasks.some((t) => t.status === "queued" || t.status === "processing");
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
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : "加载任务失败");
      });
    return () => {
      cancelled = true;
    };
  }, [config, selectedId]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !t.filename.toLowerCase().includes(q)) return false;
      if (statusFilter === "completed") return t.status === "completed";
      if (statusFilter === "failed") return t.status === "failed";
      if (statusFilter === "active") return t.status === "queued" || t.status === "processing";
      return true;
    });
  }, [tasks, searchQuery, statusFilter]);

  const completedCount = useMemo(
    () => tasks.filter((t) => t.status === "completed").length,
    [tasks],
  );

  const toc = useMemo(() => extractToc(draftMarkdown), [draftMarkdown]);
  const stats = useMemo(() => countMarkdownWords(draftMarkdown), [draftMarkdown]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      let lastId: string | null = null;
      for (const file of Array.from(files)) {
        const created = await uploadFile(config, file, engine);
        lastId = created.task_id;
      }
      const list = await listTasks(config);
      setTasks(list);
      if (lastId) {
        setSelectedId(lastId);
        setMobileTab("reader");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSelectTask = (taskId: string) => {
    setSelectedId(taskId);
    setMobileTab("reader");
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(config, taskId);
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
      if (selectedId === taskId) {
        setSelectedId(null);
        setSelectedTask(null);
        setDraftMarkdown("");
        setDirty(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleRetry = async (taskId: string, overrideEngine?: EngineChoice) => {
    try {
      setErrorMsg(null);
      const updated = await retryTask(config, taskId, overrideEngine);
      setTasks((prev) => prev.map((t) => (t.task_id === taskId ? updated : t)));
      if (selectedId === taskId) {
        setSelectedTask(updated);
        setDirty(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "重试失败");
    }
  };

  const handleSaveMarkdown = async () => {
    if (!selectedTask || selectedTask.status !== "completed") return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const updated = await updateTaskMarkdown(config, selectedTask.task_id, draftMarkdown);
      setSelectedTask(updated);
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === updated.task_id ? { ...t, markdown_length: updated.markdown_length } : t,
        ),
      );
      setDirty(false);
      setSaveToast(true);
      window.setTimeout(() => setSaveToast(false), 1800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleBatchZip = async () => {
    setExportingZip(true);
    setErrorMsg(null);
    try {
      const ids = filteredTasks.filter((t) => t.status === "completed").map((t) => t.task_id);
      await downloadExportZip(config, ids.length > 0 ? ids : undefined);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "批量导出失败");
    } finally {
      setExportingZip(false);
    }
  };

  const handleCopy = async () => {
    if (!draftMarkdown) return;
    await navigator.clipboard.writeText(draftMarkdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const scrollToHeading = (headingId: string) => {
    const el = document.getElementById(headingId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

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

  const toggleCompareSource = () => {
    setCompareSource((prev) => {
      const next = !prev;
      if (next) setSidebarCollapsed(true);
      return next;
    });
  };

  const toggleQuickTheme = () => {
    const next = effectiveTheme === "dark" ? "light" : "dark";
    setConfig((prev) => ({ ...prev, theme: next }));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="icon-pill desktop-only"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="brand-mark">
            <span className="brand-logo">M</span>
            <div className="brand-text">
              <strong>MarkItDown</strong>
              <span className={`conn-pill ${health ? "ok" : "err"}`}>
                <span className="conn-dot" />
                {health
                  ? `已连接 · ${health.engines.docling ? "双引擎就绪" : "MarkItDown"}`
                  : "后端离线"}
              </span>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          {completedCount > 0 && (
            <button
              className="apple-btn subtle"
              onClick={handleBatchZip}
              disabled={exportingZip}
              title="打包下载所有已完成文档"
            >
              {exportingZip ? <Loader2 size={15} className="spin" /> : <Archive size={15} />}
              <span className="hide-sm">批量导出 ZIP ({completedCount})</span>
            </button>
          )}
          <button className="icon-pill" onClick={toggleQuickTheme} title="切换浅色 / 深色">
            {effectiveTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="icon-pill" onClick={() => refreshServer(config)} title="刷新任务列表">
            <RefreshCw size={16} />
          </button>
          <button className="apple-btn subtle" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
            <span className="hide-sm">设置</span>
          </button>
        </div>
      </header>

      {(healthError || errorMsg) && (
        <div className="toast-banner error">
          <span>{healthError || errorMsg}</span>
          <button className="banner-close" onClick={() => { setErrorMsg(null); setHealthError(null); }}>
            ×
          </button>
        </div>
      )}

      <main className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside className={`sidebar ${mobileTab === "reader" ? "mobile-hidden" : ""}`}>
          <div className={`upload-card ${mobileTab === "tasks" ? "mobile-compact-hide" : ""}`}>
            <div className="engine-row">
              <span>解析引擎</span>
              <select
                className="apple-select compact"
                value={engine}
                onChange={(e) => setEngine(e.target.value as EngineChoice)}
              >
                <option value="auto">智能路由（推荐）</option>
                <option value="markitdown">MarkItDown（Office 极速）</option>
                <option value="docling" disabled={health ? !health.engines.docling : false}>
                  Docling（论文 / 扫描件）
                </option>
              </select>
            </div>

            <div
              className={`dropzone ${dragActive ? "active" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.csv,.png,.jpg,.jpeg,.webp,.tif,.tiff"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <div className="dropzone-icon">
                {uploading ? <Loader2 size={22} className="spin" /> : <UploadCloud size={22} />}
              </div>
              <strong>{uploading ? "正在上传并排队..." : "拖拽或点击批量上传"}</strong>
              <small>Word · Excel · PPT · PDF · 扫描件图片</small>
            </div>
          </div>

          <div className={`task-panel ${mobileTab === "upload" ? "mobile-hidden" : ""}`}>
            <div className="search-box">
              <Search size={14} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索文件名..."
              />
            </div>

            <div className="filter-pills">
              {(
                [
                  ["all", "全部"],
                  ["completed", "已完成"],
                  ["active", "处理中"],
                  ["failed", "失败"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={statusFilter === key ? "active" : ""}
                  onClick={() => setStatusFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="task-scroll">
              {filteredTasks.length === 0 ? (
                <div className="empty-sidebar">
                  <FolderOpen size={24} />
                  <p>{tasks.length === 0 ? "暂无文档，上传一个试试" : "没有匹配的文档"}</p>
                </div>
              ) : (
                filteredTasks.map((task) => (
                  <div
                    key={task.task_id}
                    className={`task-card ${selectedId === task.task_id ? "selected" : ""}`}
                    onClick={() => handleSelectTask(task.task_id)}
                  >
                    <div className="task-card-icon">{getFileIcon(task.filename)}</div>
                    <div className="task-card-body">
                      <div className="task-card-title" title={task.filename}>
                        {task.filename}
                      </div>
                      <div className="task-card-meta">
                        <span className={`status-pill ${task.status}`}>
                          {task.status === "completed"
                            ? "已完成"
                            : task.status === "failed"
                              ? "失败"
                              : task.status === "processing"
                                ? "解析中"
                                : "排队中"}
                        </span>
                        <span>{task.engine_used || task.engine_requested}</span>
                        <span>· {formatRelativeTime(task.created_at)}</span>
                      </div>
                    </div>
                    <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
                      {task.status === "failed" && (
                        <button
                          className="mini-icon-btn"
                          title="重试转换"
                          onClick={() => handleRetry(task.task_id)}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                      <button
                        className="mini-icon-btn danger"
                        title="删除任务"
                        onClick={() => handleDelete(task.task_id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className={`reader-pane ${mobileTab !== "reader" ? "mobile-hidden" : ""}`}>
          {!selectedTask ? (
            <div className="reader-empty">
              <div className="empty-badge">
                <FileText size={32} />
              </div>
              <h2>选择或上传一个文档开始阅读</h2>
              <p>支持 GFM 复杂表格、学术论文 LaTeX 公式渲染、目录大纲跳转与在线微调导出</p>
            </div>
          ) : (
            <>
              <div className="reader-toolbar">
                <div className="reader-meta">
                  <div className="reader-filename">{selectedTask.filename}</div>
                  <div className="reader-stats">
                    <span>引擎：{selectedTask.engine_used || selectedTask.engine_requested}</span>
                    <span>· 大小：{formatBytes(selectedTask.file_size)}</span>
                    <span>· 耗时：{formatDuration(selectedTask.duration_ms)}</span>
                    {selectedTask.status === "completed" && (
                      <span>· {stats.words} 词 / {stats.chars} 字符</span>
                    )}
                  </div>
                </div>

                <div className="reader-actions">
                  <div className="view-segmented">
                    <button
                      className={viewMode === "preview" ? "active" : ""}
                      onClick={() => setViewMode("preview")}
                    >
                      <Eye size={14} />
                      <span>预览</span>
                    </button>
                    <button
                      className={viewMode === "split" ? "active" : ""}
                      onClick={() => setViewMode("split")}
                    >
                      <Columns2 size={14} />
                      <span>双栏对照</span>
                    </button>
                    <button
                      className={viewMode === "source" ? "active" : ""}
                      onClick={() => setViewMode("source")}
                    >
                      <FileCode2 size={14} />
                      <span>源码</span>
                    </button>
                  </div>

                  <button
                    className={`apple-btn ${compareSource ? "primary" : "subtle"}`}
                    onClick={toggleCompareSource}
                    title="左侧显示原文件（PDF/扫描图片），右侧对照预览或修改 Markdown"
                  >
                    <SplitSquareHorizontal size={14} />
                    <span>原文对照</span>
                  </button>

                  {toc.length > 0 && viewMode !== "source" && (
                    <button
                      className={`icon-pill ${tocOpen ? "active" : ""}`}
                      onClick={() => setTocOpen((v) => !v)}
                      title="目录大纲"
                    >
                      <ListTree size={16} />
                    </button>
                  )}

                  {dirty && (
                    <button
                      className="apple-btn subtle"
                      onClick={handleSaveMarkdown}
                      disabled={saving}
                    >
                      {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                      <span>保存修改</span>
                    </button>
                  )}
                  {saveToast && <span className="saved-tag">已保存</span>}

                  <button
                    className="apple-btn subtle"
                    disabled={selectedTask.status !== "completed"}
                    onClick={handleCopy}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? "已复制" : "复制"}</span>
                  </button>

                  <button
                    className="apple-btn primary"
                    disabled={selectedTask.status !== "completed"}
                    onClick={() =>
                      downloadLocalMarkdown(
                        draftMarkdown,
                        selectedTask.filename,
                        selectedTask.task_id,
                      )
                    }
                  >
                    <Download size={14} />
                    <span>导出 .md</span>
                  </button>
                </div>
              </div>

              <div className="reader-content-wrap">
                {selectedTask.status === "queued" || selectedTask.status === "processing" ? (
                  <div className="reader-empty">
                    <Loader2 size={32} className="spin" />
                    <h3>正在使用 {selectedTask.engine_requested} 解析文档...</h3>
                    <p>扫描件 OCR 与复杂学术论文可能需要数十秒，请稍候</p>
                  </div>
                ) : selectedTask.status === "failed" ? (
                  <div className="failed-card">
                    <h3>转换失败</h3>
                    <pre>{selectedTask.error}</pre>
                    <div className="failed-actions">
                      <button
                        className="apple-btn primary"
                        onClick={() => handleRetry(selectedTask.task_id)}
                      >
                        <RotateCcw size={14} />
                        <span>原引擎重试</span>
                      </button>
                      <button
                        className="apple-btn subtle"
                        onClick={() => handleRetry(selectedTask.task_id, "docling")}
                      >
                        <span>改用 Docling 重试</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`compare-shell ${compareSource ? "with-source" : ""}`}
                    ref={compareContainerRef}
                  >
                    {compareSource && (
                      <>
                        <div
                          className="source-column"
                          style={{ flexBasis: `${sourceWidthPct}%` }}
                        >
                          <SourceViewer
                            config={config}
                            taskId={selectedTask.task_id}
                            filename={selectedTask.filename}
                          />
                        </div>
                        <div
                          className="split-resizer"
                          title="拖动调节原文与 Markdown 宽度"
                          onMouseDown={() => {
                            resizingRef.current = true;
                            document.body.style.cursor = "col-resize";
                          }}
                        />
                      </>
                    )}

                    <div className={`reader-grid ${viewMode}`}>
                      {(viewMode === "source" || viewMode === "split") && (
                        <div className="editor-pane">
                          <div className="pane-caption">Markdown 源码（可直接微调编辑）</div>
                          <textarea
                            className="markdown-editor"
                            value={draftMarkdown}
                            onChange={(e) => {
                              setDraftMarkdown(e.target.value);
                              setDirty(true);
                            }}
                            spellCheck={false}
                          />
                        </div>
                      )}

                      {(viewMode === "preview" || viewMode === "split") && (
                        <div className="preview-scroll" ref={previewScrollRef}>
                          <MarkdownPreview markdown={draftMarkdown} />
                        </div>
                      )}

                      {tocOpen && toc.length > 0 && viewMode !== "source" && !compareSource && (
                        <aside className="toc-rail">
                          <div className="toc-title">文档目录</div>
                          <nav className="toc-list">
                            {toc.map((item) => (
                              <button
                                key={item.id}
                                className={`toc-item level-${item.level}`}
                                onClick={() => scrollToHeading(item.id)}
                                title={item.text}
                              >
                                {item.text}
                              </button>
                            ))}
                          </nav>
                        </aside>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <nav className="mobile-tabbar">
        <button
          className={mobileTab === "tasks" ? "active" : ""}
          onClick={() => setMobileTab("tasks")}
        >
          <FolderOpen size={18} />
          <span>文档 ({tasks.length})</span>
        </button>
        <button
          className={mobileTab === "upload" ? "active" : ""}
          onClick={() => setMobileTab("upload")}
        >
          <UploadCloud size={18} />
          <span>上传</span>
        </button>
        <button
          className={mobileTab === "reader" ? "active" : ""}
          onClick={() => setMobileTab("reader")}
        >
          <Eye size={18} />
          <span>阅读器</span>
        </button>
      </nav>

      <SettingsModal
        open={settingsOpen}
        config={config}
        health={health}
        onChange={setConfig}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
