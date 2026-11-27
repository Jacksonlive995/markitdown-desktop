import { useEffect, useState } from "react";
import {
  Bell,
  BookMarked,
  CheckCircle2,
  Cloud,
  FolderOpen,
  KeyRound,
  Laptop,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Server,
  Sparkles,
  Sun,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react";
import { testServerConnection, testVlmConnection } from "../api";
import { DEFAULT_VLM_PROMPT } from "../stores/ui-store";
import type {
  DeploymentMode,
  EngineChoice,
  HealthResponse,
  ServerConfig,
  ServerProfile,
  ThemeMode,
} from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  open: boolean;
  config: ServerConfig;
  health: HealthResponse | null;
  onSave: (next: ServerConfig) => void;
  onClose: () => void;
}

const LOCAL_URL = "http://127.0.0.1:8000";

const VLM_PRESETS = [
  {
    name: "OpenAI (GPT-4o-mini)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    name: "通义千问 (Qwen-VL-Max)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-max",
  },
  {
    name: "本地 Ollama (Qwen2.5-VL)",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5vl:7b",
  },
];

export function SettingsModal({ open, config, health, onSave, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"server" | "vlm" | "vault">("server");
  const [draft, setDraft] = useState<ServerConfig>(config);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    health?: HealthResponse;
    authOk?: boolean;
    error?: string;
  } | null>(null);
  const [testingVlm, setTestingVlm] = useState(false);
  const [vlmTestResult, setVlmTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
      setVlmTestResult(null);
    }
  }, [open, config]);

  const handleModeSwitch = (mode: DeploymentMode) => {
    if (mode === "local") {
      setDraft((prev) => ({
        ...prev,
        mode: "local",
        baseUrl: LOCAL_URL,
      }));
    } else {
      const remoteProfile = draft.savedProfiles?.find((p) => p.mode === "remote");
      setDraft((prev) => ({
        ...prev,
        mode: "remote",
        baseUrl:
          remoteProfile?.baseUrl ||
          (prev.baseUrl === LOCAL_URL ? "http://192.168.1.100:8000" : prev.baseUrl),
        token: remoteProfile?.token ?? prev.token,
      }));
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testServerConnection({
        baseUrl: draft.baseUrl,
        token: draft.token,
      });
      setTestResult({
        ok: true,
        latencyMs: res.latencyMs,
        health: res.health,
        authOk: res.authOk,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "无法连接到该服务地址",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestVlm = async () => {
    setTestingVlm(true);
    setVlmTestResult(null);
    try {
      const res = await testVlmConnection(draft);
      setVlmTestResult({
        ok: true,
        message: `连接成功 (${res.model})：${res.reply || "OK"}`,
      });
    } catch (err) {
      setVlmTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "VLM 连接测试失败",
      });
    } finally {
      setTestingVlm(false);
    }
  };

  const handleSaveProfile = () => {
    const name =
      profileName.trim() ||
      (draft.mode === "local" ? "本机服务" : `远程节点 (${draft.baseUrl})`);
    const newProfile: ServerProfile = {
      id: `prof-${Date.now()}`,
      name,
      mode: draft.mode,
      baseUrl: draft.baseUrl.trim(),
      token: draft.token,
    };
    setDraft((prev) => ({
      ...prev,
      savedProfiles: [...(prev.savedProfiles ?? []), newProfile],
    }));
    setProfileName("");
  };

  const handleDeleteProfile = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      savedProfiles: (prev.savedProfiles ?? []).filter((p) => p.id !== id),
    }));
  };

  const handleApply = () => {
    onSave(draft);
    onClose();
  };

  const displayHealth = testResult?.health ?? health;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>服务部署、AI 视觉模型与知识库设置</DialogTitle>
          <DialogDescription>
            配置本机/远程后端、OpenAI 兼容多模态 VLM 视觉模型以及 Obsidian 知识库导出目录，点击「保存并应用」生效
          </DialogDescription>
        </DialogHeader>

        {/* Top Segmented Tabs */}
        <div className="grid grid-cols-3 rounded-xl bg-secondary p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("server")}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all",
              activeTab === "server"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Server className="h-3.5 w-3.5" />
            <span>服务与外观</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vlm")}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all",
              activeTab === "vlm"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>AI 视觉 (VLM)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vault")}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all",
              activeTab === "vault"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BookMarked className="h-3.5 w-3.5" />
            <span>Obsidian 知识库</span>
          </button>
        </div>

        {/* ============================================================ */}
        {/* Tab 1: Server & Appearance                                   */}
        {/* ============================================================ */}
        {activeTab === "server" && (
          <div className="space-y-4 py-1">
            {/* Deployment Mode Switcher: Local vs Remote */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                后端部署模式（支持本地与远程双模式）
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleModeSwitch("local")}
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
                    draft.mode === "local"
                      ? "border-primary bg-primary/[0.07] shadow-[0_0_0_1px_var(--primary)]"
                      : "border-border bg-background/60 hover:bg-accent/50",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      draft.mode === "local"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Laptop className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">本机服务 (Local)</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      连接本机运行的 FastAPI 双引擎服务 (127.0.0.1:8000)
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleModeSwitch("remote")}
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
                    draft.mode === "remote"
                      ? "border-primary bg-primary/[0.07] shadow-[0_0_0_1px_var(--primary)]"
                      : "border-border bg-background/60 hover:bg-accent/50",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      draft.mode === "remote"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Cloud className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">远程服务器 (VPS / 局域网)</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      连接自建 Docker 容器、云服务器或团队共享转换节点
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Saved Server Profiles */}
            {draft.savedProfiles && draft.savedProfiles.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">已保存的服务器节点</div>
                <div className="flex flex-wrap gap-1.5">
                  {draft.savedProfiles.map((prof) => {
                    const active =
                      draft.baseUrl.trim() === prof.baseUrl.trim() && draft.mode === prof.mode;
                    return (
                      <div
                        key={prof.id}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border bg-background text-foreground hover:bg-accent",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setDraft((prev) => ({
                              ...prev,
                              mode: prof.mode,
                              baseUrl: prof.baseUrl,
                              token: prof.token,
                            }));
                            setTestResult(null);
                          }}
                          className="inline-flex items-center gap-1"
                        >
                          <Server className="h-3 w-3 opacity-70" />
                          <span>{prof.name}</span>
                        </button>
                        {prof.id !== "local-default" && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProfile(prof.id)}
                            className="ml-1 text-muted-foreground hover:text-destructive"
                            title="移除该节点"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Server URL & Token Inputs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Cloud className="h-3.5 w-3.5" />
                  <span>后端服务地址</span>
                </label>
                <input
                  type="url"
                  value={draft.baseUrl}
                  onChange={(e) => {
                    setDraft({ ...draft, baseUrl: e.target.value });
                    setTestResult(null);
                  }}
                  placeholder="http://127.0.0.1:8000"
                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>API Token（可选，与 API_TOKEN 一致）</span>
                </label>
                <input
                  type="password"
                  value={draft.token}
                  onChange={(e) => {
                    setDraft({ ...draft, token: e.target.value });
                    setTestResult(null);
                  }}
                  placeholder="未开启鉴权可留空"
                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Save as Profile & Test Connection Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="节点备注名（如：香港 VPS）"
                  className="h-7 w-40 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                />
                <Button variant="secondary" size="xs" onClick={handleSaveProfile}>
                  <Plus className="h-3 w-3" />
                  <span>存为常用节点</span>
                </Button>
              </div>

              <Button
                variant="secondary"
                size="xs"
                onClick={handleTestConnection}
                disabled={testing || !draft.baseUrl.trim()}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <Wifi className="h-3.5 w-3.5 text-primary" />
                )}
                <span>测试连接</span>
              </Button>
            </div>

            {/* Connection Test / Engine Status Card */}
            <div className="rounded-xl border border-border bg-background/80 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">服务端引擎状态</span>
                {testResult && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      testResult.ok && testResult.authOk !== false
                        ? "text-success"
                        : "text-destructive",
                    )}
                  >
                    {testResult.ok && testResult.authOk !== false ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>连接成功 ({testResult.latencyMs} ms)</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5" />
                        <span>
                          {testResult.authOk === false
                            ? "连接成功但 API Token 鉴权失败"
                            : testResult.error}
                        </span>
                      </>
                    )}
                  </span>
                )}
              </div>

              {displayHealth ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={displayHealth.engines.markitdown ? "success" : "destructive"}>
                    <CheckCircle2 className="h-3 w-3" />
                    MarkItDown {displayHealth.engines.markitdown ? "就绪" : "未安装"}
                  </Badge>
                  <Badge variant={displayHealth.engines.docling ? "success" : "destructive"}>
                    <CheckCircle2 className="h-3 w-3" />
                    Docling {displayHealth.engines.docling ? "就绪" : "未安装"}
                  </Badge>
                  {displayHealth.version && (
                    <Badge variant="secondary">API v{displayHealth.version}</Badge>
                  )}
                  <Badge variant="outline">
                    {displayHealth.auth_required ? "已启用 Token 鉴权" : "免鉴权模式"}
                  </Badge>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  尚未连接到后端服务，请点击上方「测试连接」验证地址与端口。
                </p>
              )}
            </div>

            {/* Default Engine & Appearance */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">默认解析引擎</label>
                <select
                  value={draft.defaultEngine}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultEngine: e.target.value as EngineChoice })
                  }
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="auto">智能路由（PDF/图片→Docling，Office→MarkItDown）</option>
                  <option value="markitdown">MarkItDown（轻量极速，适合 Word/Excel/PPT）</option>
                  <option value="docling">Docling（深度版面分析，适合论文/扫描件）</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">界面主题外观</label>
                <div className="grid grid-cols-3 rounded-lg bg-secondary p-0.5 text-xs">
                  {(
                    [
                      ["system", "跟随系统", Monitor],
                      ["light", "浅色", Sun],
                      ["dark", "深色", Moon],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDraft({ ...draft, theme: key as ThemeMode })}
                      className={cn(
                        "inline-flex items-center justify-center gap-1 rounded-[6px] py-1 font-medium transition-all",
                        draft.theme === key
                          ? "bg-card text-foreground shadow-2xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Auto-save & Desktop Notification toggles */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-xs cursor-pointer">
                <div>
                  <div className="font-semibold text-foreground">编辑时自动保存</div>
                  <div className="text-[11px] text-muted-foreground">修改后 1.5 秒防抖同步</div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.autoSave}
                  onChange={(e) => setDraft({ ...draft, autoSave: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-xs cursor-pointer">
                <div>
                  <div className="inline-flex items-center gap-1 font-semibold text-foreground">
                    <Bell className="h-3 w-3 text-primary" />
                    <span>后台任务完成通知</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">批量解析完成后发送系统提醒</div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.desktopNotifications}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setDraft({ ...draft, desktopNotifications: enabled });
                    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
                      Notification.requestPermission().catch(() => {});
                    }
                  }}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Tab 2: OpenAI-Compatible VLM Vision Enhancement              */}
        {/* ============================================================ */}
        {activeTab === "vlm" && (
          <div className="space-y-4 py-1">
            <label className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/[0.06] px-3.5 py-3 text-xs cursor-pointer">
              <div>
                <div className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>启用 AI 视觉增强 (OpenAI 兼容 VLM)</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  支持对文档提取出的架构图、流程图、数据图表生成结构化 Markdown 说明与 Mermaid 图表
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.vlmEnabled}
                onChange={(e) => setDraft({ ...draft, vlmEnabled: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
            </label>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">常用模型端点一键填入</div>
              <div className="flex flex-wrap gap-1.5">
                {VLM_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        vlmEnabled: true,
                        vlmBaseUrl: preset.baseUrl,
                        vlmModel: preset.model,
                      }));
                      setVlmTestResult(null);
                    }}
                    className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  API Base URL（OpenAI 兼容）
                </label>
                <input
                  type="url"
                  value={draft.vlmBaseUrl}
                  onChange={(e) => {
                    setDraft({ ...draft, vlmBaseUrl: e.target.value });
                    setVlmTestResult(null);
                  }}
                  placeholder="https://api.openai.com/v1"
                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  多模态模型名称 (Model)
                </label>
                <input
                  type="text"
                  value={draft.vlmModel}
                  onChange={(e) => {
                    setDraft({ ...draft, vlmModel: e.target.value });
                    setVlmTestResult(null);
                  }}
                  placeholder="gpt-4o-mini / qwen-vl-max"
                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">
                API Key（本地 Ollama 可留空）
              </label>
              <input
                type="password"
                value={draft.vlmApiKey}
                onChange={(e) => {
                  setDraft({ ...draft, vlmApiKey: e.target.value });
                  setVlmTestResult(null);
                }}
                placeholder="sk-..."
                className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground">
                  视觉解读提示词 (Prompt)
                </label>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, vlmPrompt: DEFAULT_VLM_PROMPT })}
                  className="text-[11px] text-primary hover:underline"
                >
                  恢复默认提示词
                </button>
              </div>
              <textarea
                rows={3}
                value={draft.vlmPrompt}
                onChange={(e) => setDraft({ ...draft, vlmPrompt: e.target.value })}
                className="w-full rounded-xl border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/35 p-2.5">
              <div className="min-w-0 flex-1 text-xs">
                {vlmTestResult ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      vlmTestResult.ok ? "text-success" : "text-destructive",
                    )}
                  >
                    {vlmTestResult.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{vlmTestResult.message}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    配置完成后，既可在转换时自动解读全部插图，也可在阅读器中对单张插图点选解读
                  </span>
                )}
              </div>

              <Button
                variant="secondary"
                size="xs"
                onClick={handleTestVlm}
                disabled={testingVlm || !draft.vlmBaseUrl.trim() || !draft.vlmModel.trim()}
              >
                {testingVlm ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                )}
                <span>测试 VLM 连接</span>
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Tab 3: Obsidian / Local Knowledge Base Vault Export          */}
        {/* ============================================================ */}
        {activeTab === "vault" && (
          <div className="space-y-4 py-1">
            <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3.5 text-xs leading-relaxed text-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <BookMarked className="h-4 w-4 text-primary" />
                <span>一键导出至 Obsidian / 本地知识库</span>
              </div>
              <p className="text-muted-foreground">
                绑定本地 Obsidian Vault 目录后，点击顶栏「存入知识库」即可一键将当前 Markdown 文档（含 YAML Frontmatter）与提取出的{" "}
                <code className="font-mono">assets/</code> 全部插图自动写入对应子目录，并重写相对图片路径，实现零摩擦入库。
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                <span>本地知识库根目录绝对路径（如 Obsidian Vault 路径）</span>
              </label>
              <input
                type="text"
                value={draft.vaultPath}
                onChange={(e) => setDraft({ ...draft, vaultPath: e.target.value })}
                placeholder="例如：D:\Obsidian\MyKnowledgeVault 或 /Users/name/Documents/Obsidian"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  默认写入子目录
                </label>
                <input
                  type="text"
                  value={draft.vaultSubfolder}
                  onChange={(e) => setDraft({ ...draft, vaultSubfolder: e.target.value })}
                  placeholder="MarkItDown"
                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>

              <label className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2 text-xs cursor-pointer self-end">
                <div>
                  <div className="font-semibold text-foreground">自动补齐 YAML Frontmatter</div>
                  <div className="text-[10.5px] text-muted-foreground">写入 title/source/tags</div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.vaultAutoFrontmatter}
                  onChange={(e) =>
                    setDraft({ ...draft, vaultAutoFrontmatter: e.target.checked })
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>
            </div>

            {/* Output structure preview */}
            <div className="rounded-xl border border-border bg-muted/35 p-3 font-mono text-[11px] text-muted-foreground space-y-1">
              <div className="font-sans text-[11px] font-semibold text-foreground">
                写入目录结构预览
              </div>
              <div className="truncate">
                📄 {(draft.vaultPath || "<Vault>").replace(/[\\/]+$/, "")}/
                {draft.vaultSubfolder ? `${draft.vaultSubfolder}/` : ""}
                <span className="text-primary">文档名.md</span>
              </div>
              <div className="truncate">
                🖼️ {(draft.vaultPath || "<Vault>").replace(/[\\/]+$/, "")}/
                {draft.vaultSubfolder ? `${draft.vaultSubfolder}/` : ""}assets/
                <span className="text-primary">文档名/fig_01.png</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleApply}>保存并应用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
