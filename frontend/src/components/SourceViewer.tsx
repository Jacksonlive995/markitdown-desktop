import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileWarning,
  Loader2,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { fetchSourceBlobUrl, fetchSourcePreview, triggerBlobDownload } from "../api";
import type { ServerConfig, SourcePreviewResponse } from "../types";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface SourceViewerProps {
  config: ServerConfig;
  taskId: string;
  filename: string;
}

export function SourceViewer({ config, taskId, filename }: SourceViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<SourcePreviewResponse | null>(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [contentType, setContentType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgScale, setImgScale] = useState(1);
  const [imgRotate, setImgRotate] = useState(0);

  const lower = filename.toLowerCase();
  const isPdf = contentType.includes("pdf") || lower.endsWith(".pdf");
  const isImage =
    contentType.startsWith("image/") || /\.(png|jpg|jpeg|webp|tif|tiff|bmp)$/.test(lower);
  const isHtml = contentType.includes("html") || /\.(html|htm)$/.test(lower);
  const isCsv = contentType.includes("csv") || lower.endsWith(".csv");
  const isOfficeRich = /\.(docx|xlsx|xlsm|pptx)$/.test(lower);
  const isTextLike =
    isHtml ||
    isCsv ||
    contentType.startsWith("text/") ||
    /\.(txt|md|json|xml|csv|html|htm)$/.test(lower);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setTextPreview(null);
    setOfficePreview(null);
    setActiveSheetIdx(0);
    setRawBlob(null);
    setImgScale(1);
    setImgRotate(0);

    const loadAll = async () => {
      try {
        const [{ url, contentType: ct, blob }, officeRes] = await Promise.all([
          fetchSourceBlobUrl(config, taskId),
          isOfficeRich ? fetchSourcePreview(config, taskId).catch(() => null) : Promise.resolve(null),
        ]);

        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setBlobUrl(url);
        setRawBlob(blob);
        setContentType(ct);
        if (officeRes && officeRes.kind !== "unsupported") {
          setOfficePreview(officeRes);
        }

        const textExt = /\.(txt|md|json|xml|csv|html|htm)$/i.test(filename);
        if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || textExt) {
          const text = await blob.text();
          if (active) setTextPreview(text.slice(0, 120_000));
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "原文件加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAll();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [config, taskId, filename, isOfficeRich]);

  const csvRows = useMemo(() => {
    if (!isCsv || !textPreview) return null;
    return textPreview
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(0, 80)
      .map((line) => line.split(","));
  }, [isCsv, textPreview]);

  const activeSheet =
    officePreview?.kind === "xlsx" && officePreview.sheets
      ? officePreview.sheets[activeSheetIdx] ?? officePreview.sheets[0]
      : null;

  const handleDownloadSource = () => {
    if (rawBlob) {
      triggerBlobDownload(rawBlob, filename);
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-toolbar/70 px-3.5 py-1.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            源文件
          </span>
          <span className="truncate font-medium text-foreground" title={filename}>
            {filename}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isImage && blobUrl && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setImgScale((s) => Math.max(0.3, +(s - 0.2).toFixed(1)))}
                title="缩小"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="w-11 text-center font-mono text-[11px] text-muted-foreground">
                {Math.round(imgScale * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setImgScale((s) => Math.min(3.5, +(s + 0.2).toFixed(1)))}
                title="放大"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setImgRotate((r) => (r + 90) % 360)}
                title="旋转 90°"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setImgScale(1);
                  setImgRotate(0);
                }}
                title="重置视图"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {rawBlob && (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleDownloadSource}
              title="下载原始上传文件"
            >
              <Download className="h-3 w-3" />
              <span>下载原件</span>
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-xs">正在加载原文件流...</span>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center text-muted-foreground">
          <FileWarning className="h-7 w-7 text-destructive" />
          <span className="text-xs">{error}</span>
        </div>
      ) : isPdf && blobUrl ? (
        <iframe
          className="flex-1 w-full border-0 bg-[#525659]"
          src={`${blobUrl}#view=FitH`}
          title={filename}
        />
      ) : isImage && blobUrl ? (
        <div className="flex-1 overflow-auto bg-background/80 p-5">
          <img
            src={blobUrl}
            alt={filename}
            style={{
              width: `${imgScale * 100}%`,
              transform: `rotate(${imgRotate}deg)`,
            }}
            className="mx-auto block rounded-lg shadow-sm transition-transform duration-150"
          />
        </div>
      ) : officePreview?.kind === "xlsx" && officePreview.sheets && activeSheet ? (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-background">
          {/* Multi-Sheet Tab Switcher */}
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/35 px-3 py-1.5">
            <div className="flex items-center gap-1 overflow-x-auto">
              {officePreview.sheets.map((sheet, idx) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheetIdx(idx)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    idx === activeSheetIdx
                      ? "bg-card text-foreground shadow-2xs border border-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FileSpreadsheet className="h-3 w-3 text-success" />
                  <span>{sheet.name}</span>
                </button>
              ))}
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              共 {activeSheet.total_rows} 行{activeSheet.truncated ? "（预览前 200 行）" : ""}
            </span>
          </div>

          <div className="flex-1 overflow-auto p-3">
            {activeSheet.rows.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">当前工作表为空</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-xs">
                    <tr>
                      <th className="w-9 border-b border-r border-border px-2 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
                        #
                      </th>
                      {activeSheet.rows[0].map((cell, cIdx) => (
                        <th
                          key={cIdx}
                          className="border-b border-r border-border px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap"
                        >
                          {cell || `Col ${cIdx + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.rows.slice(1).map((row, rIdx) => (
                      <tr key={rIdx} className="even:bg-muted/25 hover:bg-primary/[0.04]">
                        <td className="border-b border-r border-border px-2 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
                          {rIdx + 2}
                        </td>
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="border-b border-r border-border px-3 py-1.5 text-foreground"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (officePreview?.kind === "docx" || officePreview?.kind === "pptx") && officePreview.html ? (
        <div className="flex-1 overflow-y-auto bg-muted/25 p-5">
          <div
            className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xs prose prose-sm dark:prose-invert max-w-none [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2.5 [&_th]:py-1.5 [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_.pptx-slide]:mb-5 [&_.pptx-slide]:rounded-xl [&_.pptx-slide]:border [&_.pptx-slide]:border-border [&_.pptx-slide]:p-4"
            dangerouslySetInnerHTML={{ __html: officePreview.html }}
          />
        </div>
      ) : isCsv && csvRows ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/70">
                  {csvRows[0]?.map((cell, idx) => (
                    <th key={idx} className="border-b border-r border-border px-3 py-2 text-left font-semibold">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvRows.slice(1).map((row, rIdx) => (
                  <tr key={rIdx} className="even:bg-muted/30">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="border-b border-r border-border px-3 py-1.5">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : isHtml && blobUrl ? (
        <iframe
          className="flex-1 w-full border-0 bg-white"
          sandbox=""
          src={blobUrl}
          title={filename}
        />
      ) : isTextLike && textPreview !== null ? (
        <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
          {textPreview}
        </pre>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {/\.(xlsx|xls)$/i.test(lower) ? (
              <FileSpreadsheet className="h-6 w-6" />
            ) : (
              <FileText className="h-6 w-6" />
            )}
          </div>
          <div className="max-w-xs space-y-1">
            <h4 className="text-sm font-semibold text-foreground">{filename}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              当前格式（{filename.split(".").pop()?.toUpperCase() || "FILE"}）不支持内联渲染，请直接核对右侧 Markdown 或下载原件查看。
            </p>
          </div>
          {rawBlob && (
            <Button variant="secondary" size="sm" onClick={handleDownloadSource}>
              <Download className="h-3.5 w-3.5" />
              <span>下载原文件 ({filename})</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
