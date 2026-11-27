export type EngineChoice = "auto" | "markitdown" | "docling";

export type OcrModeChoice = "auto" | "force_full_page" | "off";

export type TaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type ThemeMode = "system" | "light" | "dark";

export type WorkspaceMode = "read" | "edit" | "proofread";

export type EditSubMode = "split" | "editor" | "diff";

export type DiffMode = "original" | "engine_ab";

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

export interface VlmConfig {
  vlmEnabled: boolean;
  vlmBaseUrl: string;
  vlmApiKey: string;
  vlmModel: string;
  vlmPrompt: string;
}

export interface VaultConfig {
  vaultPath: string;
  vaultSubfolder: string;
  vaultAutoFrontmatter: boolean;
}

export interface ConversionOptions {
  pageRange: string;
  ocrMode: OcrModeChoice;
  extractImages: boolean;
  useVlm: boolean;
  frontmatter: boolean;
}

export interface ServerConfig extends VlmConfig, VaultConfig {
  mode: DeploymentMode;
  baseUrl: string;
  token: string;
  defaultEngine: EngineChoice;
  theme: ThemeMode;
  autoSave: boolean;
  desktopNotifications: boolean;
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
  vlm_configured?: boolean;
  features?: string[];
}

export interface ConversionTask {
  task_id: string;
  filename: string;
  file_size?: number;
  engine_requested: EngineChoice;
  engine_used: string | null;
  status: TaskStatus;
  progress_pct?: number;
  progress_stage?: string | null;
  created_at: string;
  finished_at: string | null;
  duration_ms?: number | null;
  error: string | null;
  markdown_length: number;
  pinned?: boolean;
  edited?: boolean;
  assets?: string[];
  engine_snapshots?: string[];
  engine_results?: Record<string, string>;
  source_url?: string | null;
  match_snippet?: string | null;
  match_source?: "filename" | "content" | "both";
  options?: {
    page_range?: string;
    ocr_mode?: OcrModeChoice;
    extract_images?: boolean;
    use_vlm?: boolean;
    frontmatter?: boolean;
  };
  markdown?: string;
  original_markdown?: string;
}

export interface SourcePreviewResponse {
  kind: "xlsx" | "docx" | "pptx" | "unsupported";
  sheets?: {
    name: string;
    rows: string[][];
    total_rows: number;
    truncated?: boolean;
  }[];
  html?: string;
  block_count?: number;
  slide_count?: number;
  extension?: string;
}

export interface TaskEventMessage {
  type:
    | "connected"
    | "task_created"
    | "task_progress"
    | "task_completed"
    | "task_failed"
    | "task_cancelled"
    | "task_updated"
    | "task_deleted";
  task?: ConversionTask;
  ts?: string;
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
