import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("@codemirror") ||
              id.includes("@uiw/react-codemirror") ||
              id.includes("@lezer")
            ) {
              return "codemirror";
            }
            if (
              id.includes("katex") ||
              id.includes("rehype-") ||
              id.includes("remark-") ||
              id.includes("react-markdown") ||
              id.includes("highlight.js") ||
              id.includes("lowlight") ||
              id.includes("micromark") ||
              id.includes("mdast") ||
              id.includes("hast")
            ) {
              return "markdown-katex";
            }
            if (id.includes("radix-ui") || id.includes("@radix-ui") || id.includes("cmdk")) {
              return "radix-ui";
            }
            if (id.includes("lucide-react")) {
              return "lucide";
            }
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
});
