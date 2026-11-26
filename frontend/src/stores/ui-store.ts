import { create } from "zustand";
import type {
  EditSubMode,
  EngineChoice,
  InspectorTab,
  MobileTab,
  ReaderTypography,
  ServerConfig,
  ServerProfile,
  SortField,
  StatusFilter,
  WorkspaceMode,
} from "../types";

const STORAGE_KEY = "markitdown_v1_config";

const DEFAULT_PROFILES: ServerProfile[] = [
  {
    id: "local-default",
    name: "本机服务 (127.0.0.1:8000)",
    mode: "local",
    baseUrl: "http://127.0.0.1:8000",
    token: "",
  },
];

const DEFAULT_TYPOGRAPHY: ReaderTypography = {
  font: "sans",
  fontSize: 16,
  width: "standard",
};

export function loadConfig(): ServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const baseUrl = parsed.baseUrl || "http://127.0.0.1:8000";
      const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl.trim());
      return {
        mode: parsed.mode || (isLocal ? "local" : "remote"),
        baseUrl,
        token: parsed.token || "",
        defaultEngine: parsed.defaultEngine || "auto",
        theme: parsed.theme || "system",
        autoSave: parsed.autoSave ?? true,
        typography: {
          font: parsed.typography?.font || DEFAULT_TYPOGRAPHY.font,
          fontSize: parsed.typography?.fontSize || DEFAULT_TYPOGRAPHY.fontSize,
          width: parsed.typography?.width || DEFAULT_TYPOGRAPHY.width,
        },
        savedProfiles:
          Array.isArray(parsed.savedProfiles) && parsed.savedProfiles.length > 0
            ? parsed.savedProfiles
            : DEFAULT_PROFILES,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    mode: "local",
    baseUrl: "http://127.0.0.1:8000",
    token: "",
    defaultEngine: "auto",
    theme: "system",
    autoSave: true,
    typography: DEFAULT_TYPOGRAPHY,
    savedProfiles: DEFAULT_PROFILES,
  };
}

export function persistConfig(cfg: ServerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

interface UiState {
  config: ServerConfig;
  engine: EngineChoice;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  mobileInspectorOpen: boolean;
  workspaceMode: WorkspaceMode;
  editSubMode: EditSubMode;
  mobileTab: MobileTab;
  settingsOpen: boolean;
  commandOpen: boolean;
  searchQuery: string;
  statusFilter: StatusFilter;
  sortField: SortField;
  batchMode: boolean;
  selectedTaskIds: string[];
  activeHeadingId: string | null;

  setConfig: (next: ServerConfig | ((prev: ServerConfig) => ServerConfig)) => void;
  setTypography: (patch: Partial<ReaderTypography>) => void;
  setEngine: (engine: EngineChoice) => void;
  setSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  setInspectorOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setMobileInspectorOpen: (v: boolean) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setEditSubMode: (sub: EditSubMode) => void;
  setMobileTab: (tab: MobileTab) => void;
  setSettingsOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSearchQuery: (q: string) => void;
  setStatusFilter: (f: StatusFilter) => void;
  setSortField: (s: SortField) => void;
  setBatchMode: (v: boolean) => void;
  toggleBatchSelect: (taskId: string) => void;
  setSelectedTaskIds: (ids: string[]) => void;
  setActiveHeadingId: (id: string | null) => void;
}

const initialConfig = loadConfig();

export const useUiStore = create<UiState>((set) => ({
  config: initialConfig,
  engine: initialConfig.defaultEngine,
  sidebarCollapsed: false,
  inspectorOpen: true,
  inspectorTab: "toc",
  mobileInspectorOpen: false,
  workspaceMode: "read",
  editSubMode: "split",
  mobileTab: "hub",
  settingsOpen: false,
  commandOpen: false,
  searchQuery: "",
  statusFilter: "all",
  sortField: "created_desc",
  batchMode: false,
  selectedTaskIds: [],
  activeHeadingId: null,

  setConfig: (next) =>
    set((state) => {
      const resolved = typeof next === "function" ? next(state.config) : next;
      persistConfig(resolved);
      return { config: resolved };
    }),
  setTypography: (patch) =>
    set((state) => {
      const resolved: ServerConfig = {
        ...state.config,
        typography: { ...state.config.typography, ...patch },
      };
      persistConfig(resolved);
      return { config: resolved };
    }),
  setEngine: (engine) => set({ engine }),
  setSidebarCollapsed: (v) =>
    set((s) => ({
      sidebarCollapsed: typeof v === "function" ? v(s.sidebarCollapsed) : v,
    })),
  setInspectorOpen: (v) =>
    set((s) => ({
      inspectorOpen: typeof v === "function" ? v(s.inspectorOpen) : v,
    })),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setMobileInspectorOpen: (mobileInspectorOpen) => set({ mobileInspectorOpen }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  setEditSubMode: (editSubMode) => set({ editSubMode }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCommandOpen: (v) =>
    set((s) => ({
      commandOpen: typeof v === "function" ? v(s.commandOpen) : v,
    })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSortField: (sortField) => set({ sortField }),
  setBatchMode: (batchMode) =>
    set((s) => ({
      batchMode,
      selectedTaskIds: batchMode ? s.selectedTaskIds : [],
    })),
  toggleBatchSelect: (taskId) =>
    set((s) => ({
      selectedTaskIds: s.selectedTaskIds.includes(taskId)
        ? s.selectedTaskIds.filter((id) => id !== taskId)
        : [...s.selectedTaskIds, taskId],
    })),
  setSelectedTaskIds: (selectedTaskIds) => set({ selectedTaskIds }),
  setActiveHeadingId: (activeHeadingId) => set({ activeHeadingId }),
}));
