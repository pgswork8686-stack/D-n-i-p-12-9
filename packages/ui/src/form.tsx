"use client";

import React, { useEffect, useRef } from "react";

export interface FormFieldProps {
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  /** A single input/select/textarea; id and aria attributes are injected. */
  children: React.ReactElement;
  className?: string;
}

/** Label + control + hint/error, wired with aria-describedby / aria-invalid. */
export function FormField({ id, label, error, hint, required, children, className = "" }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = React.cloneElement(children, {
    id,
    required,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  });
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        )}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export interface ErrorSummaryProps {
  /** field id → message */
  errors: Record<string, string | undefined>;
  title?: string;
  /** Change this (e.g. submit count) to re-focus the summary. */
  focusKey?: number;
}

/** Lists form errors with links to each field; focused after a failed submit. */
export function ErrorSummary({ errors, title = "Vui lòng kiểm tra lại thông tin", focusKey }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors).filter(([, m]) => !!m) as [string, string][];
  const hasErrors = entries.length > 0;
  useEffect(() => {
    if (hasErrors) ref.current?.focus();
  }, [focusKey, hasErrors]);
  if (entries.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm outline-none">
      <p className="font-semibold text-ink">{title}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#${field}`} className="text-danger underline underline-offset-2">
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
