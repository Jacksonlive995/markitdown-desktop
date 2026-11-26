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
import { fetchSourceBlobUrl, triggerBlobDownload } from "../api";
import type { ServerConfig } from "../types";
import { Button } from "./ui/button";

interface SourceViewerProps {
  config: ServerConfig;
  taskId: string;
  filename: string;
}

export function SourceViewer({ config, taskId, filename }: SourceViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
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
    setRawBlob(null);
    setImgScale(1);
    setImgRotate(0);

    fetchSourceBlobUrl(config, taskId)
      .then(async ({ url, contentType: ct, blob }) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setBlobUrl(url);
        setRawBlob(blob);
        setContentType(ct);

        const textExt = /\.(txt|md|json|xml|csv|html|htm)$/i.test(filename);
        if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || textExt) {
          const text = await blob.text();
          if (active) setTextPreview(text.slice(0, 120_000));
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "原文件加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [config, taskId, filename]);

  const csvRows = useMemo(() => {
    if (!isCsv || !textPreview) return null;
    return textPreview
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(0, 80)
      .map((line) => line.split(","));
  }, [isCsv, textPreview]);

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
              Office 原生二进制格式（{filename.split(".").pop()?.toUpperCase() || "DOCX/XLSX"}）已由后端提取为右侧结构化 Markdown，你也可以下载原件核对。
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
