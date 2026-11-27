import { useEffect, useState } from "react";
import { Command } from "cmdk";
import {
  BookMarked,
  BookOpen,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileText,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  SplitSquareHorizontal,
  Sun,
} from "lucide-react";
import { listTasks } from "../api";
import type { CleanupAction, ConversionTask, ServerConfig, WorkspaceMode } from "../types";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ServerConfig;
  tasks: ConversionTask[];
  selectedTask: ConversionTask | null;
  onSelectTask: (taskId: string) => void;
  onNewConversion: () => void;
  onLoadSample: () => void;
  onSwitchMode: (mode: WorkspaceMode) => void;
  onCleanup: (action: CleanupAction) => void;
  onCopyMarkdown: () => void;
  onExportMd: () => void;
  onExportHtml: () => void;
  onExportToVault: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  dark: boolean;
}

export function CommandPalette({
  open,
  onOpenChange,
  config,
  tasks,
  selectedTask,
  onSelectTask,
  onNewConversion,
  onLoadSample,
  onSwitchMode,
  onCleanup,
  onCopyMarkdown,
  onExportMd,
  onExportHtml,
  onExportToVault,
  onToggleTheme,
  onOpenSettings,
  dark,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [contentHits, setContentHits] = useState<ConversionTask[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setContentHits([]);
      return;
    }
    const q = query.trim();
    if (!q) {
      setContentHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listTasks(config, q)
        .then((res) => {
          if (!cancelled) setContentHits(res);
        })
        .catch(() => {
          if (!cancelled) setContentHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, config]);

  const runAndClose = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  const docCandidates = query.trim() && contentHits.length > 0 ? contentHits : tasks.slice(0, 20);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-lg overflow-hidden p-0">
        <DialogTitle className="sr-only">全局命令面板</DialogTitle>
        <Command className="flex flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="全文搜索文档正文、切换模式、一键入库 Obsidian 或执行排版命令..."
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <Command.List className="max-h-[380px] overflow-y-auto p-2 text-xs">
            <Command.Empty className="py-8 text-center text-muted-foreground">
              未找到匹配的命令或文档
            </Command.Empty>

            <Command.Group
              heading="快捷操作"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                onSelect={() => runAndClose(onNewConversion)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
                <span>新建文档转换（打开转换中心）</span>
              </Command.Item>
              <Command.Item
                onSelect={() => runAndClose(onLoadSample)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
              >
                <BookOpen className="h-4 w-4" />
                <span>载入学术论文与公式示例文稿</span>
              </Command.Item>
            </Command.Group>

            {selectedTask && selectedTask.status === "completed" && (
              <Command.Group
                heading={`当前文档：${selectedTask.filename}`}
                className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                <Command.Item
                  onSelect={() => runAndClose(onExportToVault)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <BookMarked className="h-4 w-4" />
                  <span>一键存入知识库 (Obsidian Vault)</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(() => onSwitchMode("read"))}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <Eye className="h-4 w-4" />
                  <span>切换到「阅读」模式</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(() => onSwitchMode("edit"))}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <Code2 className="h-4 w-4" />
                  <span>切换到「编辑」模式（CodeMirror 双栏同步 / A/B Diff）</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(() => onSwitchMode("proofread"))}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <SplitSquareHorizontal className="h-4 w-4" />
                  <span>切换到「校对」模式（原件 PDF / Word / Excel 对照）</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(() => onCleanup("smart_all"))}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>执行一键智能排版精修</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(onCopyMarkdown)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <Copy className="h-4 w-4" />
                  <span>复制 Markdown 到剪贴板</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(onExportMd)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <Download className="h-4 w-4" />
                  <span>导出为 .md 文件</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => runAndClose(onExportHtml)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                >
                  <FileCode2 className="h-4 w-4" />
                  <span>导出为独立排版 .html 网页（内嵌 Base64 图片）</span>
                </Command.Item>
              </Command.Group>
            )}

            {docCandidates.length > 0 && (
              <Command.Group
                heading={query.trim() ? "全文检索命中文档" : "跳转到文档"}
                className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {docCandidates.map((t) => (
                  <Command.Item
                    key={t.task_id}
                    value={`${t.filename} ${t.match_snippet ?? ""} ${query} ${t.task_id}`}
                    onSelect={() => runAndClose(() => onSelectTask(t.task_id))}
                    className="flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 truncate">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate font-medium">{t.filename}</span>
                      </span>
                      <span className="text-[11px] opacity-70 shrink-0">
                        {t.engine_used || t.engine_requested}
                      </span>
                    </div>
                    {t.match_snippet && (
                      <span className="line-clamp-1 pl-5.5 text-[10.5px] opacity-80">
                        {t.match_snippet}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group
              heading="系统与外观"
              className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                onSelect={() => runAndClose(onToggleTheme)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span>切换浅色 / 深色主题</span>
              </Command.Item>
              <Command.Item
                onSelect={() => runAndClose(onOpenSettings)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-default select-none aria-selected:bg-primary aria-selected:text-primary-foreground"
              >
                <Settings className="h-4 w-4" />
                <span>打开服务、VLM 模型与 Obsidian 知识库设置</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
