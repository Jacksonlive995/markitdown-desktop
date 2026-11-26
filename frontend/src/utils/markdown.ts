import type { CleanupAction, MarkdownStats, TocItem } from "../types";

export function slugifyHeading(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || "section";
}

export function cleanDisplayMarkdown(markdown: string): string {
  return markdown.replace(/<!--\s*image\s*-->/gi, "").replace(/\n{3,}/g, "\n\n");
}

export function extractToc(markdown: string): TocItem[] {
  const cleaned = cleanDisplayMarkdown(markdown);
  const lines = cleaned.split(/\r?\n/);
  const items: TocItem[] = [];
  const counts = new Map<string, number>();
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (!match) continue;

    const level = match[1].length;
    const rawText = match[2]
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
    if (!rawText) continue;

    const base = slugifyHeading(rawText);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen}`;
    items.push({ id, level, text: rawText, line: i + 1 });
  }
  return items;
}

export function analyzeMarkdown(markdown: string): MarkdownStats {
  if (!markdown) {
    return {
      chars: 0,
      words: 0,
      cjk: 0,
      latin: 0,
      lines: 0,
      paragraphs: 0,
      headings: 0,
      tables: 0,
      codeBlocks: 0,
      formulas: 0,
      links: 0,
      readingMinutes: 0,
    };
  }
  const codeBlockMatches = markdown.match(/```[\s\S]*?```/g) ?? [];
  const formulaBlockMatches = markdown.match(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g) ?? [];
  const linkMatches = markdown.match(/\[[^\]]+\]\([^)]+\)/g) ?? [];
  const tableMatches = markdown.match(/^\|.+\|\r?\n\|[\s:|-]+\|/gm) ?? [];

  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~[\]()|-]/g, " ");
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (plain.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) ?? []).length;
  const words = cjk + latin;
  const lines = markdown.split(/\r?\n/).length;
  const paragraphs = markdown
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
  const headings = extractToc(markdown).length;
  const readingMinutes = words > 0 ? Math.max(1, Math.ceil(words / 320)) : 0;

  return {
    chars: markdown.length,
    words,
    cjk,
    latin,
    lines,
    paragraphs,
    headings,
    tables: tableMatches.length,
    codeBlocks: codeBlockMatches.length,
    formulas: formulaBlockMatches.length,
    links: linkMatches.length,
    readingMinutes,
  };
}

export function countMarkdownWords(markdown: string): { chars: number; words: number } {
  const s = analyzeMarkdown(markdown);
  return { chars: s.chars, words: s.words };
}

export function stripMarkdownToPlainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\w-]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Intelligent Markdown cleanup / post-processing tools
 */
export function applyMarkdownCleanup(
  markdown: string,
  action: CleanupAction,
): { result: string; summary: string } {
  if (!markdown.trim()) {
    return { result: markdown, summary: "文档为空，无需处理" };
  }

  const collapseBlank = (text: string) =>
    text
      .replace(/[ \t]+$/gm, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n";

  const stripArtifacts = (text: string) =>
    text
      .replace(/<!--\s*image\s*-->/gi, "")
      .replace(/<!--\s*page\s*\d+\s*-->/gi, "")
      .replace(/^\s*-\s*\d+\s*-\s*$/gm, "")
      .replace(/\[\s*\]\(\s*\)/g, "");

  const normalizeHeadings = (text: string) => {
    const lines = text.split(/\r?\n/);
    let inFence = false;
    let minLevel = 6;

    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("```") || t.startsWith("~~~")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s*\S/.exec(t);
      if (m) minLevel = Math.min(minLevel, m[1].length);
    }
    const shift = minLevel > 1 && minLevel <= 6 ? minLevel - 1 : 0;
    inFence = false;

    return lines
      .map((line) => {
        const t = line.trim();
        if (t.startsWith("```") || t.startsWith("~~~")) {
          inFence = !inFence;
          return line;
        }
        if (inFence) return line;
        const m = /^(#{1,6})\s*(.+?)\s*#*$/.exec(t);
        if (!m) return line;
        const newLevel = Math.max(1, Math.min(6, m[1].length - shift));
        return `${"#".repeat(newLevel)} ${m[2].trim()}`;
      })
      .join("\n");
  };

  const mergePdfBrokenLines = (text: string) => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    let inFence = false;
    let inMath = false;

    const isStructural = (s: string) => {
      const t = s.trim();
      if (!t) return true;
      return (
        /^#{1,6}\s/.test(t) ||
        /^[-*+]\s/.test(t) ||
        /^\d+[.)]\s/.test(t) ||
        /^>\s?/.test(t) ||
        /^\|/.test(t) ||
        /^---+$|^\*\*\*+$|^___+$/.test(t) ||
        /^!\[/.test(t) ||
        /^\$\$/.test(t)
      );
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inFence = !inFence;
        out.push(line);
        continue;
      }
      if (trimmed.startsWith("$$")) {
        inMath = !inMath;
        out.push(line);
        continue;
      }
      if (inFence || inMath || isStructural(line)) {
        out.push(line);
        continue;
      }

      const prev = out.length > 0 ? out[out.length - 1] : "";
      const prevTrim = prev.trim();
      const prevEndsSentence = /[。！？.!?：:；;”"）)\]】]$/.test(prevTrim);

      if (prevTrim && !isStructural(prev) && !prevEndsSentence) {
        const cjkBoundary =
          /[\u4e00-\u9fff]$/.test(prevTrim) && /^[\u4e00-\u9fff]/.test(trimmed);
        const hyphenSplit = /[A-Za-z]-$/.test(prevTrim) && /^[a-z]/.test(trimmed);
        if (hyphenSplit) {
          out[out.length - 1] = prevTrim.slice(0, -1) + trimmed;
        } else if (cjkBoundary) {
          out[out.length - 1] = prevTrim + trimmed;
        } else {
          out[out.length - 1] = `${prevTrim} ${trimmed}`;
        }
      } else {
        out.push(line);
      }
    }
    return out.join("\n");
  };

  const cjkSpacing = (text: string) => {
    const lines = text.split(/\r?\n/);
    let inFence = false;
    return lines
      .map((line) => {
        const t = line.trim();
        if (t.startsWith("```") || t.startsWith("~~~")) {
          inFence = !inFence;
          return line;
        }
        if (inFence) return line;
        return line
          .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2")
          .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
      })
      .join("\n");
  };

  const formatTables = (text: string) => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
      if (
        lines[i].trim().startsWith("|") &&
        i + 1 < lines.length &&
        /^\|[\s:|-]+\|/.test(lines[i + 1].trim())
      ) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          tableLines.push(lines[i].trim());
          i++;
        }
        const rows = tableLines.map((row) =>
          row
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim()),
        );
        const colCount = Math.max(...rows.map((r) => r.length));
        const widths = Array.from({ length: colCount }, (_, colIdx) =>
          Math.max(
            3,
            ...rows.map((r, rIdx) => (rIdx === 1 ? 3 : (r[colIdx] ?? "").length)),
          ),
        );
        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
          const cells = Array.from({ length: colCount }, (_, colIdx) => {
            const val = rows[rIdx][colIdx] ?? "";
            if (rIdx === 1) {
              if (val.startsWith(":") && val.endsWith(":")) {
                return `:${"-".repeat(Math.max(1, widths[colIdx] - 2))}:`;
              }
              if (val.endsWith(":")) {
                return `${"-".repeat(Math.max(1, widths[colIdx] - 1))}:`;
              }
              return "-".repeat(widths[colIdx]);
            }
            return val.padEnd(widths[colIdx], " ");
          });
          out.push(`| ${cells.join(" | ")} |`);
        }
      } else {
        out.push(lines[i]);
        i++;
      }
    }
    return out.join("\n");
  };

  switch (action) {
    case "collapse_blank_lines":
      return { result: collapseBlank(markdown), summary: "已压缩多余空行与行尾空白" };
    case "strip_artifacts":
      return {
        result: collapseBlank(stripArtifacts(markdown)),
        summary: "已清理残留图片占位符与无效标签",
      };
    case "normalize_headings":
      return {
        result: collapseBlank(normalizeHeadings(markdown)),
        summary: "已规范化标题层级与空格",
      };
    case "merge_pdf_broken_lines":
      return {
        result: collapseBlank(mergePdfBrokenLines(markdown)),
        summary: "已智能合并 PDF 跨行断句",
      };
    case "cjk_spacing":
      return {
        result: cjkSpacing(markdown),
        summary: "已优化中英文与数字间距",
      };
    case "format_tables":
      return {
        result: formatTables(markdown),
        summary: "已对齐并规范化 Markdown 表格",
      };
    case "smart_all":
    default: {
      let res = stripArtifacts(markdown);
      res = normalizeHeadings(res);
      res = cjkSpacing(res);
      res = formatTables(res);
      res = collapseBlank(res);
      return {
        result: res,
        summary: "已完成一键智能排版精修（清理标签、规范标题、中英间距、表格对齐、空行压缩）",
      };
    }
  }
}

export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function computeLineDiff(original: string, current: string): DiffLine[] {
  const a = original.replace(/\r\n/g, "\n").split("\n");
  const b = current.replace(/\r\n/g, "\n").split("\n");

  // Simple Myers/LCS window diff suitable for document paragraphs
  if (a.length * b.length > 400_000) {
    // Fallback for huge files
    const maxLen = Math.max(a.length, b.length);
    const out: DiffLine[] = [];
    for (let i = 0; i < maxLen; i++) {
      if (a[i] === b[i]) {
        out.push({ type: "same", text: a[i] ?? "", oldLine: i + 1, newLine: i + 1 });
      } else {
        if (i < a.length) out.push({ type: "removed", text: a[i], oldLine: i + 1 });
        if (i < b.length) out.push({ type: "added", text: b[i], newLine: i + 1 });
      }
    }
    return out;
  }

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "removed", text: a[i], oldLine: i + 1 });
      i++;
    } else {
      result.push({ type: "added", text: b[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    result.push({ type: "removed", text: a[i], oldLine: i + 1 });
    i++;
  }
  while (j < b.length) {
    result.push({ type: "added", text: b[j], newLine: j + 1 });
    j++;
  }
  return result;
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function getDateGroupLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;
  const t = date.getTime();

  if (t >= startOfToday) return "今天";
  if (t >= startOfYesterday) return "昨天";
  if (t >= startOfWeek) return "最近 7 天";
  return "更早";
}

export const SAMPLE_SHOWCASE_MARKDOWN = `# 深度学习文档布局解析与结构化转换研究报告

> **摘要**：本文档用于演示 **MarkItDown Desktop v2** 的阅读排版、学术公式（KaTeX）、GFM 表格、代码语法高亮、目录大纲联动与一键智能精修工作流。

## 1. 核心架构与双引擎路由

现代企业知识库与大模型 RAG 管道需要将海量的异构文档（PDF、扫描件、Word、Excel、PPT、HTML）高保真地转化为结构化 Markdown。我们采用 **智能双引擎架构**：

1. **MarkItDown 极速引擎**：针对原生 Office OpenXML（\`.docx\` / \`.xlsx\` / \`.pptx\`）、HTML、CSV 与 JSON，毫秒级流式提取。
2. **Docling 视觉与版面分析引擎**：基于深度版面检测（Layout Analysis）与 TableFormer 表格结构还原，专为学术论文、多栏 PDF 与高精度 OCR 扫描件设计。

### 1.1 性能与精度基准对比

| 文档类型 | 推荐解析引擎 | 平均耗时 (10页) | 复杂表格还原度 | 数学公式识别 |
| :--- | :--- | :--- | :--- | :--- |
| 企业财报 (\`.xlsx\`) | MarkItDown | 0.18 s | 99.4% | 支持基础符号 |
| 技术方案 (\`.docx\`) | MarkItDown | 0.24 s | 98.8% | 原生 OMML 转换 |
| 双栏学术论文 (\`.pdf\`) | Docling | 4.60 s | 97.2% | LaTeX 级还原 |
| 扫描合同图片 (\`.png\`) | Docling (OCR) | 3.20 s | 95.5% | 支持行内公式 |

## 2. 数学公式与理论模型

在多模态文档理解中，给定输入页面图像 $I \\in \\mathbb{R}^{H \\times W \\times 3}$，视觉编码器提取多尺度特征图，并通过自注意力机制计算版面区域之间的空间相关性：

$$
\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T + B_{\\text{spatial}}}{\\sqrt{d_k}}\\right)V
$$

其中 $B_{\\text{spatial}} \\in \\mathbb{R}^{N \\times N}$ 表示二维边界框（Bounding Box）的相对几何位置偏置，整体训练损失函数定义为：

$$
\\mathcal{L}_{\\text{total}} = \\lambda_{\\text{cls}} \\mathcal{L}_{\\text{focal}} + \\lambda_{\\text{box}} \\mathcal{L}_{\\text{GIoU}} + \\lambda_{\\text{seq}} \\sum_{t=1}^{T} -\\log P(y_t \\mid y_{<t}, I)
$$

## 3. 代码示例与 API 调用

你可以通过本地服务（\`127.0.0.1:8000\`）或远程自建 VPS 节点调用转换接口：

\`\`\`python
import httpx

async def convert_document(file_path: str, engine: str = "auto") -> dict:
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=60.0) as client:
        with open(file_path, "rb") as f:
            resp = await client.post(
                "/api/convert",
                files={"file": (file_path, f)},
                data={"engine": engine},
            )
            resp.raise_for_status()
            return resp.json()
\`\`\`

## 4. 下一步校对建议

- 切换到顶部 **「编辑」** 模式，体验 **CodeMirror 6** 语法高亮编辑器、格式化工具栏与 **修订对比（Diff）** 视图。
- 打开右侧 **「检查器 → 工具」** 面板，实时调节衬线/无衬线字体、字号、页宽，或执行 **一键智能精修**。
`;
