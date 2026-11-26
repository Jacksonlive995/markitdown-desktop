import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  KeyRound,
  Laptop,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Server,
  Sun,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react";
import { testServerConnection } from "../api";
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

export function SettingsModal({ open, config, health, onSave, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState<ServerConfig>(config);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    health?: HealthResponse;
    authOk?: boolean;
    error?: string;
  } | null>(null);
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
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
          <DialogTitle>服务部署与工作台偏好</DialogTitle>
          <DialogDescription>
            支持连接本机后端引擎（127.0.0.1）或远程自建 VPS / 局域网节点，配置完成后点击「保存并应用」生效
          </DialogDescription>
        </DialogHeader>

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

          {/* Auto-save toggle */}
          <label className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-xs cursor-pointer">
            <div>
              <div className="font-semibold text-foreground">编辑时自动保存</div>
              <div className="text-[11px] text-muted-foreground">
                在源码编辑器修改 Markdown 后自动防抖同步到服务端（1.5 秒）
              </div>
            </div>
            <input
              type="checkbox"
              checked={draft.autoSave}
              onChange={(e) => setDraft({ ...draft, autoSave: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
          </label>
        </div>

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
