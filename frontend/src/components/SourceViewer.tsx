import { useEffect, useState } from "react";
import { FileWarning, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { fetchSourceBlobUrl } from "../api";
import type { ServerConfig } from "../types";

interface SourceViewerProps {
  config: ServerConfig;
  taskId: string;
  filename: string;
}

export function SourceViewer({ config, taskId, filename }: SourceViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgScale, setImgScale] = useState(1);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setImgScale(1);

    fetchSourceBlobUrl(config, taskId)
      .then(({ url, contentType: ct }) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setBlobUrl(url);
        setContentType(ct);
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
  }, [config, taskId]);

  const lower = filename.toLowerCase();
  const isPdf = contentType.includes("pdf") || lower.endsWith(".pdf");
  const isImage =
    contentType.startsWith("image/") || /\.(png|jpg|jpeg|webp|tif|tiff|bmp)$/.test(lower);

  return (
    <div className="source-viewer-pane">
      <div className="pane-caption source-caption">
        <span>原文件对照：{filename}</span>
        {isImage && blobUrl && (
          <div className="zoom-controls">
            <button
              className="mini-icon-btn"
              onClick={() => setImgScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)))}
              title="缩小"
            >
              <ZoomOut size={14} />
            </button>
            <span>{Math.round(imgScale * 100)}%</span>
            <button
              className="mini-icon-btn"
              onClick={() => setImgScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}
              title="放大"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="source-empty">
          <Loader2 size={24} className="spin" />
          <span>正在加载原文件...</span>
        </div>
      ) : error ? (
        <div className="source-empty">
          <FileWarning size={24} />
          <span>{error}</span>
        </div>
      ) : isPdf && blobUrl ? (
        <iframe className="source-pdf-frame" src={`${blobUrl}#view=FitH`} title={filename} />
      ) : isImage && blobUrl ? (
        <div className="source-image-scroll">
          <img
            src={blobUrl}
            alt={filename}
            style={{ width: `${imgScale * 100}%` }}
            className="source-image-el"
          />
        </div>
      ) : (
        <div className="source-empty">
          <FileWarning size={24} />
          <span>该格式（{filename.split(".").pop()?.toUpperCase() || "Office"}）暂不支持浏览器内联渲染，请直接查看右侧 Markdown 转换结果。</span>
        </div>
      )}
    </div>
  );
}
