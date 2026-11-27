import React, { useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUpDown,
  Ban,
  Check,
  CheckSquare,
  Cpu,
  Download,
  Edit3,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Square,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import type {
  ConversionTask,
  EngineChoice,
  SortField,
  StatusFilter,
} from "../types";
import {
  formatBytes,
  formatRelativeTime,
  getDateGroupLabel,
} from "../utils/markdown";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "@/lib/utils";

interface LibrarySidebarProps {
  tasks: ConversionTask[];
  searchTasks?: ConversionTask[] | null;
  searching?: boolean;
  selectedId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenConvertHub: () => void;
  onQuickUploadFiles: (files: FileList) => void;
  uploading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  sortField: SortField;
  onSortFieldChange: (s: SortField) => void;
  batchMode: boolean;
  onBatchModeChange: (v: boolean) => void;
  selectedTaskIds: string[];
  onToggleBatchSelect: (taskId: string) => void;
  onSelectAllBatch: (ids: string[]) => void;
  onBatchExportZip: (ids: string[]) => void;
  onBatchDelete: (ids: string[]) => void;
  onTogglePin: (task: ConversionTask) => void;
  onRenameTask: (taskId: string, newName: string) => void;
  onRetryTask: (taskId: string, engine?: EngineChoice) => void;
  onCancelTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDownloadTaskMd: (task: ConversionTask) => void;
  className?: string;
}

export function getFileTypeVisual(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")) {
    return {
      icon: FileSpreadsheet,
      bg: "bg-success/12 text-success",
      ext: lower.split(".").pop()?.toUpperCase() || "XLS",
    };
  }
  if (/\.(png|jpg|jpeg|webp|tif|tiff|bmp)$/.test(lower)) {
    return {
      icon: ImageIcon,
      bg: "bg-[#af52de]/12 text-[#af52de]",
      ext: lower.split(".").pop()?.toUpperCase() || "IMG",
    };
  }
  if (lower.endsWith(".pdf")) {
    return {
      icon: FileText,
      bg: "bg-[#ff3b30]/12 text-[#ff3b30]",
      ext: "PDF",
    };
  }
  if (/\.(html|htm|json|xml|md)$/.test(lower)) {
    return {
      icon: FileCode2,
      bg: "bg-warning/15 text-warning",
      ext: lower.split(".").pop()?.toUpperCase() || "CODE",
    };
  }
  return {
    icon: FileText,
    bg: "bg-primary/12 text-primary",
    ext: lower.split(".").pop()?.toUpperCase() || "DOC",
  };
}

export function LibrarySidebar({
  tasks,
  searchTasks,
  searching,
  selectedId,
  onSelectTask,
  onOpenConvertHub,
  onQuickUploadFiles,
  uploading,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortField,
  onSortFieldChange,
  batchMode,
  onBatchModeChange,
  selectedTaskIds,
  onToggleBatchSelect,
  onSelectAllBatch,
  onBatchExportZip,
  onBatchDelete,
  onTogglePin,
  onRenameTask,
  onRetryTask,
  onCancelTask,
  onDeleteTask,
  onDownloadTaskMd,
  className,
}: LibrarySidebarProps) {
  const quickFileRef = useRef<HTMLInputElement | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const baseList = q && searchTasks ? searchTasks : tasks;
    const list = baseList.filter((t) => {
      if (q && !searchTasks && !t.filename.toLowerCase().includes(q)) return false;
      if (statusFilter === "pinned") return Boolean(t.pinned);
      if (statusFilter === "completed") return t.status === "completed";
      if (statusFilter === "failed") return t.status === "failed" || t.status === "cancelled";
      if (statusFilter === "active")
        return t.status === "queued" || t.status === "processing";
      return true;
    });

    if (q && searchTasks) {
      return list;
    }

    return [...list].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      if (sortField === "created_asc") {
        return a.created_at.localeCompare(b.created_at);
      }
      if (sortField === "name_asc") {
        return a.filename.localeCompare(b.filename, "zh-CN");
      }
      if (sortField === "size_desc") {
        return (b.file_size ?? 0) - (a.file_size ?? 0);
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [tasks, searchTasks, searchQuery, statusFilter, sortField]);

  const groupedTasks = useMemo(() => {
    if (searchQuery.trim()) {
      return [{ label: `全文搜索命中`, items: filteredTasks }];
    }
    const groups: { label: string; items: ConversionTask[] }[] = [];
    const map = new Map<string, ConversionTask[]>();

    for (const task of filteredTasks) {
      const label = task.pinned ? "星标置顶" : getDateGroupLabel(task.created_at);
      let bucket = map.get(label);
      if (!bucket) {
        bucket = [];
        map.set(label, bucket);
        groups.push({ label, items: bucket });
      }
      bucket.push(task);
    }
    return groups;
  }, [filteredTasks, searchQuery]);

  const startRename = (task: ConversionTask, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRenamingId(task.task_id);
    setRenameValue(task.filename);
  };

  const commitRename = (taskId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameTask(taskId, trimmed);
    }
    setRenamingId(null);
  };

  const counts = useMemo(
    () => ({
      all: tasks.length,
      pinned: tasks.filter((t) => t.pinned).length,
      completed: tasks.filter((t) => t.status === "completed").length,
      active: tasks.filter((t) => t.status === "queued" || t.status === "processing")
        .length,
      failed: tasks.filter((t) => t.status === "failed" || t.status === "cancelled").length,
    }),
    [tasks],
  );

  return (
    <aside
      className={cn(
        "flex w-[308px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar glass min-h-0 select-none",
        className,
      )}
    >
      {/* Top Action Bar: New Conversion + Quick Upload */}
      <div className="flex items-center gap-1.5 p-3 pb-2">
        <Button
          onClick={onOpenConvertHub}
          className="flex-1 justify-center gap-1.5 rounded-xl h-8.5 font-semibold"
        >
          <Plus className="h-4 w-4" />
          <span>新建转换</span>
        </Button>

        <input
          ref={quickFileRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.csv,.json,.xml,.txt,.md,.epub,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp"
          onChange={(e) => {
            if (e.target.files?.length) {
              onQuickUploadFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-8.5 w-8.5 rounded-xl shrink-0"
              disabled={uploading}
              onClick={() => quickFileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>直接选择本地文件上传</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={batchMode ? "default" : "secondary"}
              size="icon"
              className="h-8.5 w-8.5 rounded-xl shrink-0"
              onClick={() => onBatchModeChange(!batchMode)}
            >
              <CheckSquare className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{batchMode ? "退出批量多选" : "批量选择文档"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Full-Text Search & Sort Bar */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-border bg-card/90 px-2.5 py-1.5 text-xs shadow-2xs focus-within:border-primary">
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索文件名或正文关键词..."
            className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon-sm"
              className="h-7.5 w-7.5 rounded-xl shrink-0"
              title="排序方式"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {(
              [
                ["created_desc", "最新上传优先"],
                ["created_asc", "最早上传优先"],
                ["name_asc", "按文件名排序"],
                ["size_desc", "按文件大小排序"],
              ] as const
            ).map(([key, label]) => (
              <DropdownMenuItem key={key} onClick={() => onSortFieldChange(key)}>
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    sortField === key ? "opacity-100" : "opacity-0",
                  )}
                />
                <span>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filter Pills */}
      <div className="px-3 pb-2">
        <div className="grid grid-cols-5 gap-0.5 rounded-xl bg-secondary p-0.5 text-[11px]">
          {(
            [
              ["all", "全部", counts.all],
              ["pinned", "星标", counts.pinned],
              ["completed", "完成", counts.completed],
              ["active", "进行", counts.active],
              ["failed", "异常", counts.failed],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => onStatusFilterChange(key)}
              className={cn(
                "flex items-center justify-center gap-0.5 rounded-[9px] py-1 font-medium transition-all",
                statusFilter === key
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{label}</span>
              {count > 0 && (
                <span className="text-[10px] opacity-65">{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Batch Toolbar when batchMode is active */}
      {batchMode && (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs">
          <button
            type="button"
            onClick={() => {
              const allIds = filteredTasks.map((t) => t.task_id);
              if (selectedTaskIds.length === allIds.length) {
                onSelectAllBatch([]);
              } else {
                onSelectAllBatch(allIds);
              }
            }}
            className="font-medium text-primary hover:underline"
          >
            {selectedTaskIds.length === filteredTasks.length && filteredTasks.length > 0
              ? "取消全选"
              : `全选 (${selectedTaskIds.length}/${filteredTasks.length})`}
          </button>

          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="xs"
              disabled={selectedTaskIds.length === 0}
              onClick={() => onBatchExportZip(selectedTaskIds)}
            >
              <Archive className="h-3 w-3" />
              <span>导出 ZIP</span>
            </Button>
            <Button
              variant="destructive"
              size="xs"
              disabled={selectedTaskIds.length === 0}
              onClick={() => onBatchDelete(selectedTaskIds)}
            >
              <Trash2 className="h-3 w-3" />
              <span>删除</span>
            </Button>
          </div>
        </div>
      )}

      {/* Task List Scroll Area */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4 space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary">
              <FolderOpen className="h-5 w-5 opacity-60" />
            </div>
            <p className="text-xs font-medium text-foreground">
              {tasks.length === 0 ? "文档库为空" : "没有符合筛选条件的文档"}
            </p>
            <p className="text-[11px] text-muted-foreground max-w-[200px]">
              {tasks.length === 0
                ? "点击上方「新建转换」或拖拽文档即可开始"
                : "尝试清空搜索词或切换其他状态分类"}
            </p>
          </div>
        ) : (
          groupedTasks.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label} ({group.items.length})
              </div>

              <div className="space-y-1">
                {group.items.map((task) => {
                  const visual = getFileTypeVisual(task.filename);
                  const FileIcon = visual.icon;
                  const isSelected = selectedId === task.task_id;
                  const isChecked = selectedTaskIds.includes(task.task_id);
                  const isProcessing =
                    task.status === "queued" || task.status === "processing";
                  const pct = Math.max(0, Math.min(100, task.progress_pct ?? 0));

                  return (
                    <div
                      key={task.task_id}
                      onClick={() => {
                        if (batchMode) {
                          onToggleBatchSelect(task.task_id);
                        } else {
                          onSelectTask(task.task_id);
                        }
                      }}
                      className={cn(
                        "group relative flex items-start gap-2.5 rounded-xl border p-2.5 transition-all cursor-pointer",
                        isSelected && !batchMode
                          ? "border-primary/50 bg-selection shadow-2xs"
                          : isChecked && batchMode
                            ? "border-primary/50 bg-primary/10"
                            : "border-transparent bg-card/75 hover:border-border hover:bg-card",
                      )}
                    >
                      {batchMode && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleBatchSelect(task.task_id);
                          }}
                          className="mt-1 text-primary shrink-0"
                        >
                          {isChecked ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )}

                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl",
                          visual.bg,
                        )}
                      >
                        <FileIcon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        {renamingId === task.task_id ? (
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(task.task_id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(task.task_id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="h-6 w-full rounded border border-primary bg-background px-1.5 text-xs text-foreground outline-none"
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            {task.pinned && (
                              <Pin className="h-3 w-3 shrink-0 text-primary fill-primary" />
                            )}
                            <span
                              className="truncate text-[13px] font-semibold text-foreground"
                              title={task.filename}
                            >
                              {task.filename}
                            </span>
                            {task.edited && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                title="已编辑微调"
                              />
                            )}
                          </div>
                        )}

                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          {task.status === "completed" ? (
                            <span className="inline-flex items-center gap-1 font-medium text-success">
                              <span className="h-1.5 w-1.5 rounded-full bg-success" />
                              {task.engine_used || task.engine_requested}
                            </span>
                          ) : task.status === "failed" ? (
                            <span className="inline-flex items-center gap-1 font-medium text-destructive">
                              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                              解析失败
                            </span>
                          ) : task.status === "cancelled" ? (
                            <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                              <Ban className="h-3 w-3" />
                              已取消
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-primary">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>{pct > 0 ? `${pct}%` : "排队中"}</span>
                            </span>
                          )}
                          <span>·</span>
                          <span>{formatBytes(task.file_size)}</span>
                          {task.assets && task.assets.length > 0 && (
                            <>
                              <span>·</span>
                              <span>{task.assets.length} 图</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{formatRelativeTime(task.created_at)}</span>
                        </div>

                        {/* Full-text search match snippet */}
                        {task.match_snippet && (
                          <p className="mt-1 line-clamp-2 rounded-md bg-primary/[0.06] px-1.5 py-0.5 text-[10.5px] leading-snug text-muted-foreground">
                            {task.match_snippet}
                          </p>
                        )}

                        {/* Live progress bar & stage + cancel */}
                        {isProcessing && (
                          <div className="mt-1.5 space-y-1">
                            <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                              <span className="truncate">
                                {task.progress_stage || (task.status === "processing" ? "正在解析..." : "等待队列...")}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCancelTask(task.task_id);
                                }}
                                className="inline-flex items-center gap-0.5 shrink-0 text-destructive hover:underline"
                                title="取消当前解析任务"
                              >
                                <XCircle className="h-3 w-3" />
                                <span>取消</span>
                              </button>
                            </div>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-primary/15">
                              {pct > 0 ? (
                                <div
                                  style={{ width: `${pct}%` }}
                                  className="h-full rounded-full bg-primary transition-all duration-300"
                                />
                              ) : (
                                <div className="h-full w-2/5 rounded-full bg-primary animate-shimmer" />
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Quick Action Menu */}
                      {!batchMode && (
                        <div
                          className="shrink-0 opacity-80 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {isProcessing && (
                                <>
                                  <DropdownMenuItem
                                    destructive
                                    onClick={() => onCancelTask(task.task_id)}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    <span>取消当前解析</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              <DropdownMenuItem onClick={() => onTogglePin(task)}>
                                <Pin className="h-3.5 w-3.5" />
                                <span>{task.pinned ? "取消星标置顶" : "星标置顶"}</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => startRename(task, e)}>
                                <Edit3 className="h-3.5 w-3.5" />
                                <span>重命名文档</span>
                              </DropdownMenuItem>
                              {task.status === "completed" && (
                                <DropdownMenuItem onClick={() => onDownloadTaskMd(task)}>
                                  <Download className="h-3.5 w-3.5" />
                                  <span>导出 .md 文件</span>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => onRetryTask(task.task_id, "markitdown")}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>用 MarkItDown 重转</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onRetryTask(task.task_id, "docling")}
                              >
                                <Cpu className="h-3.5 w-3.5" />
                                <span>用 Docling 重转</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                destructive
                                onClick={() => onDeleteTask(task.task_id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>删除该任务</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
