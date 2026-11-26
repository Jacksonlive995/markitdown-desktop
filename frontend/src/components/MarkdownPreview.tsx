import type { ReactNode } from "react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { slugifyHeading } from "../utils/markdown";

interface MarkdownPreviewProps {
  markdown: string;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  const cleanedMarkdown = useMemo(
    () => markdown.replace(/<!--\s*image\s*-->/gi, "").replace(/\n{3,}/g, "\n\n"),
    [markdown],
  );

  const components = useMemo(() => {
    const counts = new Map<string, number>();
    const nextId = (children: ReactNode) => {
      const base = slugifyHeading(flattenText(children));
      const seen = counts.get(base) ?? 0;
      counts.set(base, seen + 1);
      return seen === 0 ? base : `${base}-${seen}`;
    };

    return {
      h1: ({ children }: { children?: ReactNode }) => <h1 id={nextId(children)}>{children}</h1>,
      h2: ({ children }: { children?: ReactNode }) => <h2 id={nextId(children)}>{children}</h2>,
      h3: ({ children }: { children?: ReactNode }) => <h3 id={nextId(children)}>{children}</h3>,
      h4: ({ children }: { children?: ReactNode }) => <h4 id={nextId(children)}>{children}</h4>,
    };
  }, [markdown]);

  return (
    <article className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {cleanedMarkdown}
      </ReactMarkdown>
    </article>
  );
}
