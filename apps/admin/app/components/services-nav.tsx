"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/services", label: "Service Catalog" },
  { href: "/service-inquiries", label: "Inquiries" },
  { href: "/service-projects", label: "Projects" },
];

export function ServicesNav({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  const pathname = usePathname() || "";
  return (
    <div className="mb-8 border-b border-gray-200">
      <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="text-xs text-gray-500 hover:text-[#0037b0]">
            ← Admin home
          </Link>
          <h1 className="mt-1 text-3xl font-extrabold text-[#0037b0]">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      <nav aria-label="Services sections" className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition ${
                active ? "border-[#0037b0] text-[#0037b0]" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export const fieldClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}

/** yyyy-mm-dd for <input type="date"> from an ISO timestamp. */
export function toDateInput(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

type BadgeVariant = "success" | "warning" | "error" | "info";

export const INQUIRY_VARIANT: Record<string, BadgeVariant> = {
  NEW: "warning",
  REVIEWING: "info",
  QUALIFIED: "success",
  REJECTED: "error",
  SPAM: "error",
  CONVERTED: "success",
};

export const PROJECT_VARIANT: Record<string, BadgeVariant> = {
  PLANNING: "info",
  IN_PROGRESS: "warning",
  ON_HOLD: "info",
  IN_REVIEW: "warning",
  COMPLETED: "success",
  CANCELLED: "error",
};
