import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy, Loader2, Maximize2, Sparkles, Tag, Terminal } from "lucide-react";
import { getAssetUrl } from "../api";
import type { ReaderTypography, ServerConfig } from "../types";
import { cleanDisplayMarkdown, slugifyHeading } from "../utils/markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  markdown: string;
  typography?: ReaderTypography;
  articleRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  config?: ServerConfig;
  taskId?: string;
  onAnalyzeAsset?: (assetFilename: string) => Promise<void>;
}

interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function extractHastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (!node.children) return "";
  return node.children.map(extractHastText).join("");
}

/**
 * Deterministic Rehype plugin that assigns stable `id` attributes to h1..h4
 * during AST processing, completely eliminating the React re-render ID drift bug.
 */
function rehypeStableHeadingIds() {
  return (tree: HastNode) => {
    const counts = new Map<string, number>();
    const visit = (node: HastNode) => {
      if (node.type === "element" && node.tagName && /^h[1-4]$/.test(node.tagName)) {
        const raw = extractHastText(node).trim();
        const base = slugifyHeading(raw);
        const seen = counts.get(base) ?? 0;
        counts.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        node.properties = { ...(node.properties ?? {}), id };
      }
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    visit(tree);
  };
}

function flattenReactText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenReactText).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return flattenReactText(props.children);
  }
  return "";
}

function splitFrontmatter(markdown: string): {
  meta: Record<string, string> | null;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { meta: null, body: markdown };
  const rawYaml = match[1];
  const meta: Record<string, string> = {};
  for (const line of rawYaml.split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv && kv[2]) {
      meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  return {
    meta: Object.keys(meta).length > 0 ? meta : null,
    body: markdown.slice(match[0].length),
  };
}

function CodeBlockPre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);

  let lang = "text";
  if (React.isValidElement(children)) {
    const childProps = children.props as { className?: string };
    const cls = childProps.className ?? "";
    const match = /language-([\w-]+)/.exec(cls);
    if (match) lang = match[1];
  }

  const handleCopyCode = async () => {
    const raw = flattenReactText(children).replace(/\n$/, "");
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="md-code-block group overflow-hidden rounded-xl border border-border bg-[var(--code-bg)] shadow-2xs">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-3.5 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider">
          <Terminal className="h-3 w-3 opacity-70" />
          {lang}
        </span>
        <button
          type="button"
          onClick={handleCopyCode}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" />
              <span className="text-success">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制代码</span>
            </>
          )}
        </button>
      </div>
      <pre {...props} className="!my-0 !rounded-none !border-0 !bg-transparent">
        {children}
      </pre>
    </div>
  );
}

const WIDTH_MAP: Record<ReaderTypography["width"], string> = {
  compact: "660px",
  standard: "780px",
  wide: "980px",
};

export function MarkdownPreview({
  markdown,
  typography,
  articleRef,
  className,
  config,
  taskId,
  onAnalyzeAsset,
}: MarkdownPreviewProps) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [analyzingAsset, setAnalyzingAsset] = useState<string | null>(null);

  const { meta: frontmatter, body: bodyMarkdown } = useMemo(
    () => splitFrontmatter(cleanDisplayMarkdown(markdown)),
    [markdown],
  );

  const styleVars = useMemo(() => {
    if (!typography) return undefined;
    return {
      "--reader-font-size": `${typography.fontSize}px`,
      "--reader-width": WIDTH_MAP[typography.width] || "780px",
    } as React.CSSProperties;
  }, [typography]);

  const components = useMemo(
    () => ({
      pre: CodeBlockPre,
      table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
        <div className="md-table-wrap">
          <table {...props}>{children}</table>
        </div>
      ),
      img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
        const rawSrc = src || "";
        const isTaskAsset = /^assets\/[^/]+$/i.test(rawSrc);
        const resolvedSrc =
          isTaskAsset && config && taskId ? getAssetUrl(config, taskId, rawSrc) : rawSrc;
        const assetFile = isTaskAsset ? rawSrc.replace(/^assets\//i, "") : null;
        const isBusy = assetFile !== null && analyzingAsset === assetFile;

        return (
          <span className="not-prose group relative my-4 inline-flex max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
            <img
              {...props}
              src={resolvedSrc}
              alt={alt || "文档插图"}
              loading="lazy"
              onClick={() => setLightbox({ src: resolvedSrc, alt: alt || "文档插图" })}
              className="max-h-[520px] w-auto cursor-zoom-in object-contain bg-muted/20"
            />
            <span className="flex items-center justify-between gap-2 border-t border-border/70 bg-muted/35 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{alt || assetFile || "文档插图"}</span>
              <span className="inline-flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setLightbox({ src: resolvedSrc, alt: alt || "文档插图" })}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>放大</span>
                </button>
                {assetFile && onAnalyzeAsset && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={async () => {
                      setAnalyzingAsset(assetFile);
                      try {
                        await onAnalyzeAsset(assetFile);
                      } finally {
                        setAnalyzingAsset(null);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-60"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    <span>{isBusy ? "解读中..." : "AI 视觉解读"}</span>
                  </button>
                )}
              </span>
            </span>
          </span>
        );
      },
    }),
    [config, taskId, onAnalyzeAsset, analyzingAsset],
  );

  return (
    <>
      <article
        ref={articleRef}
        style={styleVars}
        className={cn(
          "prose md-prose w-full select-text",
          typography?.font === "serif" && "font-serif-reader",
          className,
        )}
      >
        {frontmatter && (
          <div className="not-prose mb-5 rounded-xl border border-border bg-muted/35 px-3.5 py-2.5 text-xs">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <Tag className="h-3 w-3 text-primary" />
              <span>YAML Frontmatter 元数据 (Obsidian 兼容)</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
              {Object.entries(frontmatter).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="font-mono text-muted-foreground">{k}:</span>
                  <span className="font-medium text-foreground">{v}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeStableHeadingIds, rehypeKatex, rehypeHighlight]}
          components={components}
        >
          {bodyMarkdown}
        </ReactMarkdown>
      </article>

      <Dialog open={Boolean(lightbox)} onOpenChange={(v) => !v && setLightbox(null)}>
        <DialogContent className="max-w-4xl p-3">
          <DialogHeader className="px-2 pt-1 pb-2">
            <DialogTitle className="truncate text-sm">{lightbox?.alt || "插图预览"}</DialogTitle>
          </DialogHeader>
          {lightbox && (
            <div className="flex max-h-[78vh] items-center justify-center overflow-auto rounded-xl bg-muted/30 p-3">
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className="max-h-[72vh] w-auto rounded-lg object-contain shadow-sm"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
