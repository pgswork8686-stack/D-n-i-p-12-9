import React from "react";

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Applied to both <th> and <td>, e.g. "text-right w-32". */
  className?: string;
  /** Leave out of the stacked mobile card (actions are always kept). */
  hideOnMobile?: boolean;
  /** Shown as the card title on mobile instead of a label/value pair. */
  primary?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Accessible table name (visually hidden). */
  caption: string;
  /** Rendered instead of the table when rows is empty. */
  empty?: React.ReactNode;
  /** Column key holding row actions; rendered at the bottom of mobile cards. */
  actionsKey?: string;
  className?: string;
}

/**
 * Full-width data table on md+; below md each row becomes a compact stacked
 * card so nothing scrolls the whole viewport sideways (spec §2.2 mobile).
 */
export function DataTable<T>({ columns, rows, getRowKey, caption, empty, actionsKey, className = "" }: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const primary = columns.find((c) => c.primary);
  const actions = actionsKey ? columns.find((c) => c.key === actionsKey) : undefined;
  const detail = columns.filter((c) => c !== primary && c !== actions && !c.hideOnMobile);

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-canvas text-[13px] font-semibold text-body">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`whitespace-nowrap border-b border-line px-4 py-3 ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)} className="border-b border-line last:border-0 hover:bg-canvas/60">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle text-ink ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={getRowKey(row)} className="rounded-xl border border-line bg-surface p-4">
            {primary && <div className="mb-2 font-semibold text-ink">{primary.cell(row)}</div>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {detail.map((c) => (
                <React.Fragment key={c.key}>
                  <dt className="text-muted">{c.header}</dt>
                  <dd className="min-w-0 break-words text-right text-ink">{c.cell(row)}</dd>
                </React.Fragment>
              ))}
            </dl>
            {actions && <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">{actions.cell(row)}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface PaginationProps {
  page: number;
  /** Only pass when the API returned a total; otherwise use hasNext. */
  totalPages?: number;
  hasNext?: boolean;
  onPageChange?: (page: number) => void;
  /** Build hrefs instead of callbacks (server-rendered lists). */
  hrefForPage?: (page: number) => string;
  className?: string;
}

export function Pagination({ page, totalPages, hasNext, onPageChange, hrefForPage, className = "" }: PaginationProps) {
  const canPrev = page > 1;
  const canNext = totalPages !== undefined ? page < totalPages : !!hasNext;
  if (!canPrev && !canNext) return null;

  const item = (target: number, label: string, enabled: boolean) => {
    const cls = `btn-ghost btn-sm ${enabled ? "" : "pointer-events-none opacity-50"}`;
    if (hrefForPage && enabled) {
      return (
        <a href={hrefForPage(target)} className={cls}>
          {label}
        </a>
      );
    }
    return (
      <button type="button" className={cls} disabled={!enabled} onClick={() => onPageChange?.(target)}>
        {label}
      </button>
    );
  };

  return (
    <nav aria-label="Phân trang" className={`flex items-center justify-between gap-3 ${className}`}>
      {item(page - 1, "← Trước", canPrev)}
      <span className="text-sm text-muted">
        Trang {page}
        {totalPages !== undefined ? ` / ${totalPages}` : ""}
      </span>
      {item(page + 1, "Sau →", canNext)}
    </nav>
  );
}
