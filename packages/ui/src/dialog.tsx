"use client";

import React, { useEffect, useId, useRef } from "react";

/**
 * Native <dialog> opened with showModal(): the browser makes the rest of the
 * page inert, traps focus inside, closes on Escape and returns focus to the
 * opener — no extra dependency needed.
 */
function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);
  return ref;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for irreversible actions (revoke, reject, cancel). */
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  tone = "default",
  busy,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  const ref = useModal(open, onClose);
  const titleId = useId();
  const descId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-ink/40"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description && (
          <div id={descId} className="mt-2 text-sm leading-6 text-body">
            {description}
          </div>
        )}
        {children && <div className="mt-4">{children}</div>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === "danger" ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Đang xử lý…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export interface ResponsiveDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Sticky footer, e.g. "Áp dụng bộ lọc". */
  footer?: React.ReactNode;
  side?: "left" | "right";
}

/** Full-screen on mobile, side panel from sm up. */
export function ResponsiveDrawer({ open, title, onClose, children, footer, side = "right" }: ResponsiveDrawerProps) {
  const ref = useModal(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`m-0 h-full max-h-none w-full max-w-none border-0 bg-surface p-0 text-ink backdrop:bg-ink/40 sm:h-full sm:w-[400px] ${side === "right" ? "sm:ml-auto" : "sm:mr-auto"}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-body hover:bg-canvas"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </dialog>
  );
}
