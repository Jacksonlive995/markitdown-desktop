export type EngineChoice = "auto" | "markitdown" | "docling";

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export type ThemeMode = "system" | "light" | "dark";

export type WorkspaceMode = "read" | "edit" | "proofread";

export type EditSubMode = "split" | "editor" | "diff";

export type InspectorTab = "toc" | "info" | "tools";

export type StatusFilter = "all" | "pinned" | "completed" | "active" | "failed";

export type SortField = "created_desc" | "created_asc" | "name_asc" | "size_desc";

export type MobileTab = "hub" | "library" | "workspace" | "settings";

export type ReaderFont = "sans" | "serif";
export type ReaderWidth = "compact" | "standard" | "wide";

export interface ReaderTypography {
  font: ReaderFont;
  fontSize: number; // 14 - 20
  width: ReaderWidth;
}

export type DeploymentMode = "local" | "remote";

export interface ServerProfile {
  id: string;
  name: string;
  mode: DeploymentMode;
  baseUrl: string;
  token: string;
}

export interface ServerConfig {
  mode: DeploymentMode;
  baseUrl: string;
  token: string;
  defaultEngine: EngineChoice;
  theme: ThemeMode;
  autoSave: boolean;
  typography: ReaderTypography;
  savedProfiles?: ServerProfile[];
}

export interface HealthResponse {
  status: string;
  version?: string;
  engines: {
    markitdown: boolean;
    docling: boolean;
  };
  auth_required: boolean;
  max_upload_mb?: number;
  allowed_extensions?: string[];
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
  pinned?: boolean;
  edited?: boolean;
  markdown?: string;
  original_markdown?: string;
}

export interface TocItem {
  id: string;
  level: number;
  text: string;
  line: number;
}

export interface MarkdownStats {
  chars: number;
  words: number;
  cjk: number;
  latin: number;
  lines: number;
  paragraphs: number;
  headings: number;
  tables: number;
  codeBlocks: number;
  formulas: number;
  links: number;
  readingMinutes: number;
}

export type CleanupAction =
  | "smart_all"
  | "merge_pdf_broken_lines"
  | "collapse_blank_lines"
  | "normalize_headings"
  | "cjk_spacing"
  | "format_tables"
  | "strip_artifacts";
