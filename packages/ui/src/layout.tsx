import React from "react";

type LinkLike = React.ElementType<{ href: string; className?: string; children?: React.ReactNode }>;

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Pass next/link so in-app navigation stays client-side. */
  linkComponent?: LinkLike;
  className?: string;
}

export function Breadcrumbs({ items, linkComponent: LinkComp = "a", className = "" }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Đường dẫn" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <LinkComp href={item.href} className="hover:text-brand hover:underline">
                  {item.label}
                </LinkComp>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-ink" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <span aria-hidden>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Usually a <Breadcrumbs/>. */
  breadcrumbs?: React.ReactNode;
  /** Primary actions, right-aligned on the same row as the title (desktop). */
  actions?: React.ReactNode;
  /** Badges or meta shown under the title (status, dates). */
  meta?: React.ReactNode;
  className?: string;
}

/** The single H1 of a page, with its actions on one horizontal row. */
export function PageHeader({ title, description, breadcrumbs, actions, meta, className = "" }: PageHeaderProps) {
  return (
    <header className={`space-y-3 ${className}`}>
      {breadcrumbs}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{title}</h1>
          {description && <p className="mt-1.5 text-[15px] leading-6 text-body">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface SectionHeaderProps {
  /** Used for the heading id; the section should set aria-labelledby to it. */
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** "Xem tất cả", filters or sort — right side of the same row. */
  action?: React.ReactNode;
  as?: "h2" | "h3";
  align?: "start" | "center";
  className?: string;
}

/** Topic heading row: title + description left, action right (spec §2.2). */
export function SectionHeader({
  id,
  title,
  description,
  eyebrow,
  action,
  as: Heading = "h2",
  align = "start",
  className = "",
}: SectionHeaderProps) {
  const centered = align === "center";
  return (
    <div
      className={`flex flex-wrap gap-x-6 gap-y-3 ${centered ? "flex-col items-center text-center" : "items-end justify-between"} ${className}`}
    >
      <div className={`min-w-0 ${centered ? "max-w-2xl" : "max-w-3xl"}`}>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <Heading
          id={id}
          className={Heading === "h2" ? "text-2xl font-bold tracking-tight text-ink sm:text-[30px]" : "text-lg font-semibold text-ink"}
        >
          {title}
        </Heading>
        {description && <p className="mt-2 text-[15px] leading-6 text-body">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export interface SummaryStripItem {
  label: string;
  value?: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  icon?: React.ReactNode;
}

/**
 * One horizontal row of 2–4 same-topic cells (Portal action strip, order
 * summary). Values are optional: never pass a count the API did not return.
 */
export function SummaryStrip({
  items,
  linkComponent: LinkComp = "a",
  className = "",
  label,
}: {
  items: SummaryStripItem[];
  linkComponent?: LinkLike;
  className?: string;
  label?: string;
}) {
  const cols = items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <ul aria-label={label} className={`grid grid-cols-2 gap-3 sm:gap-4 ${cols} ${className}`}>
      {items.map((item) => {
        const body = (
          <>
            <span className="flex items-center gap-2 text-sm font-medium text-body">
              {item.icon && <span aria-hidden className="text-brand">{item.icon}</span>}
              {item.label}
            </span>
            {item.value !== undefined && <span className="mt-1 block text-xl font-bold text-ink">{item.value}</span>}
            {item.hint && <span className="mt-1 block text-[13px] text-muted">{item.hint}</span>}
          </>
        );
        const cls = "block h-full rounded-xl border border-line bg-surface p-4 transition-colors";
        return (
          <li key={item.label}>
            {item.href ? (
              <LinkComp href={item.href} className={`${cls} hover:border-brand/40 hover:bg-brand-soft/60`}>
                {body}
              </LinkComp>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
