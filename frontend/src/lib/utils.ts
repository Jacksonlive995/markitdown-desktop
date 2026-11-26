import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Render a shortcut like "Mod+Shift+K" with platform-appropriate glyphs. */
export function formatShortcut(shortcut: string): string[] {
  return shortcut.split("+").map((key) => {
    if (key === "Mod") return isMac ? "⌘" : "Ctrl";
    if (key === "Shift") return isMac ? "⇧" : "Shift";
    if (key === "Alt") return isMac ? "⌥" : "Alt";
    return key;
  });
}
