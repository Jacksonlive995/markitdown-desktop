export type EngineChoice = "auto" | "markitdown" | "docling";

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export type ThemeMode = "system" | "light" | "dark";

export type ViewMode = "preview" | "split" | "source";

export type StatusFilter = "all" | "completed" | "active" | "failed";

export type MobileTab = "tasks" | "upload" | "reader";

export interface HealthResponse {
  status: string;
  engines: {
    markitdown: boolean;
    docling: boolean;
  };
  auth_required: boolean;
}

export interface ConversionTask {
  task_id: string;
  filename: string;
  file_size?: number;
  engine_requested: EngineChoice;
  engine_used: string | null;
  status: TaskStatus;
  created_at: string;
  finished_at: string | null;
  duration_ms?: number | null;
  error: string | null;
  markdown_length: number;
  markdown?: string;
}

export interface ServerConfig {
  baseUrl: string;
  token: string;
  defaultEngine: EngineChoice;
  theme: ThemeMode;
}

export interface TocItem {
  id: string;
  level: number;
  text: string;
}
