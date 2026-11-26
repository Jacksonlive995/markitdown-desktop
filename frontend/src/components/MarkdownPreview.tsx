import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy, Terminal } from "lucide-react";
import type { ReaderTypography } from "../types";
import { cleanDisplayMarkdown, slugifyHeading } from "../utils/markdown";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  markdown: string;
  typography?: ReaderTypography;
  articleRef?: React.RefObject<HTMLElement | null>;
  className?: string;
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
      if (
        node.type === "element" &&
        node.tagName &&
        /^h[1-4]$/.test(node.tagName)
      ) {
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
}: MarkdownPreviewProps) {
  const cleanedMarkdown = useMemo(() => cleanDisplayMarkdown(markdown), [markdown]);

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
    }),
    [],
  );

  return (
    <article
      ref={articleRef}
      style={styleVars}
      className={cn(
        "prose md-prose w-full select-text",
        typography?.font === "serif" && "font-serif-reader",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeStableHeadingIds, rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {cleanedMarkdown}
      </ReactMarkdown>
    </article>
  );
}
