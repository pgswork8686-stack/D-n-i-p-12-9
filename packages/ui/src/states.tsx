import React from "react";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-canvas text-body border-line",
  info: "bg-brand-soft text-brand border-brand/20",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-danger/10 text-danger border-danger/25",
};

const toneGlyph: Record<StatusTone, string> = {
  neutral: "○",
  info: "●",
  success: "✓",
  warning: "!",
  danger: "✕",
};

export interface StatusBadgeProps {
  tone?: StatusTone;
  children: React.ReactNode;
  /** Replace the default glyph; the glyph keeps status readable without colour. */
  icon?: React.ReactNode;
  className?: string;
}

export function StatusBadge({ tone = "neutral", children, icon, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-medium ${toneClasses[tone]} ${className}`}
    >
      <span aria-hidden className="text-[11px] leading-none">
        {icon ?? toneGlyph[tone]}
      </span>
      {children}
    </span>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ title, description, icon, action, className = "", compact }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface text-center ${compact ? "px-4 py-8" : "px-6 py-14"} ${className}`}
    >
      {icon && (
        <span aria-hidden className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          {icon}
        </span>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm leading-6 text-body">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function ErrorState({
  title = "Không tải được dữ liệu",
  description = "Có lỗi khi kết nối máy chủ. Vui lòng thử lại.",
  onRetry,
  retryLabel = "Thử lại",
  action,
  className = "",
  compact,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center rounded-2xl border border-danger/25 bg-danger/5 text-center ${compact ? "px-4 py-6" : "px-6 py-12"} ${className}`}
    >
      <span aria-hidden className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 font-bold text-danger">
        !
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm leading-6 text-body">{description}</p>}
      {(onRetry || action) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-ghost">
              {retryLabel}
            </button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-line/70 ${className}`} />;
}

/** Announces loading to screen readers while showing skeleton rows. */
export function LoadingBlock({ rows = 3, label = "Đang tải…", className = "" }: { rows?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`space-y-3 ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export interface NoticeProps {
  tone?: Exclude<StatusTone, "neutral">;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}

/** Inline banner for contextual information (not a toast). */
export function Notice({ tone = "info", title, children, className = "" }: NoticeProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${toneClasses[tone]} ${className}`}
    >
      <span aria-hidden className="mt-0.5 font-bold">
        {toneGlyph[tone]}
      </span>
      <div className="min-w-0 text-body">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}
