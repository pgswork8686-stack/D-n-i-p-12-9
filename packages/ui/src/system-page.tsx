import React from "react";

export interface SystemPageProps {
  code: "403" | "404" | "500";
  title: string;
  description: React.ReactNode;
  /** Buttons/links to valid destinations (home, back, sign in, retry). */
  actions?: React.ReactNode;
  /** Optional reference shown for support (e.g. Next.js error digest). */
  reference?: string;
  className?: string;
}

const glyph: Record<SystemPageProps["code"], string> = { "403": "⛔", "404": "?", "500": "!" };

/** SY01–SY03: shared body for access-denied, not-found and error screens. */
export function SystemPage({ code, title, description, actions, reference, className = "" }: SystemPageProps) {
  return (
    <section aria-labelledby="system-title" className={`mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center sm:py-24 ${className}`}>
      <span
        aria-hidden
        className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold ${code === "500" ? "bg-danger/10 text-danger" : "bg-brand-soft text-brand"}`}
      >
        {glyph[code]}
      </span>
      <p className="mt-6 text-sm font-semibold tracking-wide text-muted">Lỗi {code}</p>
      <h1 id="system-title" className="mt-2 text-[28px] font-bold tracking-tight text-ink sm:text-4xl">
        {title}
      </h1>
      <div className="mt-3 text-[15px] leading-7 text-body">{description}</div>
      {actions && <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">{actions}</div>}
      {reference && <p className="mt-6 text-xs text-muted">Mã tham chiếu: {reference}</p>}
    </section>
  );
}
