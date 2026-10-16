"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  /** Never put secrets (license keys, signed URLs, tokens) in a toast. */
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneClass: Record<ToastTone, string> = {
  success: "border-success/30",
  error: "border-danger/40",
  info: "border-line",
};
const toneGlyph: Record<ToastTone, string> = { success: "✓", error: "!", info: "i" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 8000 : 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm text-ink shadow-lift ${toneClass[t.tone]}`}
          >
            <span aria-hidden className="font-bold">
              {toneGlyph[t.tone]}
            </span>
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Đóng thông báo">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  // Outside a provider (tests, isolated renders) toasts are dropped silently.
  return ctx ?? { show: () => undefined };
}
