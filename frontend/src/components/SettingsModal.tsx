import { CheckCircle2, Cloud, KeyRound, Moon, Monitor, Sun, X } from "lucide-react";
import type { EngineChoice, HealthResponse, ServerConfig, ThemeMode } from "../types";

interface SettingsModalProps {
  open: boolean;
  config: ServerConfig;
  health: HealthResponse | null;
  onChange: (next: ServerConfig) => void;
  onClose: () => void;
}

export function SettingsModal({ open, config, health, onChange, onClose }: SettingsModalProps) {
  if (!open) return null;

  const setTheme = (theme: ThemeMode) => onChange({ ...config, theme });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>连接与偏好设置</h2>
            <p>配置自建后端地址、默认解析引擎与外观主题</p>
          </div>
          <button className="icon-pill" onClick={onClose} aria-label="关闭设置">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">
              <Cloud size={14} />
              <span>后端服务地址（VPS / 局域网 / 本机）</span>
            </label>
            <input
              className="apple-input"
              type="url"
              value={config.baseUrl}
              onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:8000"
            />
          </div>

          <div className="field-group">
            <label className="field-label">
              <KeyRound size={14} />
              <span>API Token（可选，与服务端 API_TOKEN 一致）</span>
            </label>
            <input
              className="apple-input"
              type="password"
              value={config.token}
              onChange={(e) => onChange({ ...config, token: e.target.value })}
              placeholder="未设置鉴权可留空"
            />
          </div>

          <div className="field-group">
            <label className="field-label">默认解析引擎</label>
            <select
              className="apple-select"
              value={config.defaultEngine}
              onChange={(e) => onChange({ ...config, defaultEngine: e.target.value as EngineChoice })}
            >
              <option value="auto">智能路由（PDF/图片→Docling，Office→MarkItDown）</option>
              <option value="markitdown">MarkItDown（轻量极速，适合 Word/Excel/PPT）</option>
              <option value="docling">Docling（高精度，适合扫描件/论文/复杂表格）</option>
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">界面外观</label>
            <div className="theme-segmented">
              <button
                type="button"
                className={config.theme === "system" ? "active" : ""}
                onClick={() => setTheme("system")}
              >
                <Monitor size={14} />
                <span>跟随系统</span>
              </button>
              <button
                type="button"
                className={config.theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun size={14} />
                <span>浅色</span>
              </button>
              <button
                type="button"
                className={config.theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon size={14} />
                <span>深色</span>
              </button>
            </div>
          </div>

          <div className="engine-status-card">
            <div className="engine-status-title">服务端引擎状态</div>
            {health ? (
              <div className="engine-chips">
                <span className={`engine-chip ${health.engines.markitdown ? "ready" : "off"}`}>
                  <CheckCircle2 size={13} /> MarkItDown {health.engines.markitdown ? "就绪" : "未安装"}
                </span>
                <span className={`engine-chip ${health.engines.docling ? "ready" : "off"}`}>
                  <CheckCircle2 size={13} /> Docling {health.engines.docling ? "就绪" : "未安装"}
                </span>
              </div>
            ) : (
              <span className="muted-text">当前未连接到后端服务，请检查地址或服务状态。</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
