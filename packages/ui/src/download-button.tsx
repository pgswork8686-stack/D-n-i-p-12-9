import React, { useState } from "react";

export interface DownloadButtonProps {
  onDownload: () => Promise<void> | void;
  fileName?: string;
  fileSizeBytes?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function DownloadButtonWithProgress({
  onDownload,
  fileName,
  fileSizeBytes,
  label = "Download",
  disabled = false,
  className = "",
  size = "md",
}: DownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleClick = async () => {
    if (downloading || disabled) return;
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setTimeout(() => setDownloading(false), 1500);
    }
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base font-semibold",
  };

  const formattedSize = fileSizeBytes ? formatBytes(fileSizeBytes) : "";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || downloading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 ${
        downloading
          ? "bg-blue-100 text-[#0037b0] cursor-wait"
          : disabled
            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
            : "bg-[#0037b0] hover:bg-[#002c8f] text-white shadow-sm hover:shadow active:scale-[0.98]"
      } ${sizeClasses[size]} ${className}`}
    >
      {downloading ? (
        <>
          <svg
            className="animate-spin -ml-1 mr-1 h-4 w-4 text-[#0037b0]"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <span>Preparing ZIP...</span>
        </>
      ) : (
        <>
          <span>⬇️</span>
          <span>{label}</span>
          {formattedSize && <span className="opacity-75 font-normal text-xs">({formattedSize})</span>}
        </>
      )}
    </button>
  );
}
