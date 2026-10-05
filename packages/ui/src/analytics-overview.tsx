import React from "react";
import { Card } from "./card";

/**
 * Phase 19 — shared marketing overview panel (admin + portal).
 * Renders values exactly as returned by the analytics API: no KPI formula lives in the UI.
 * Money values are integer minor units (VND: đồng, USD: cents).
 */
export interface AnalyticsOverviewLike {
  client: { name: string; currency: string };
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  totals: Record<string, number>;
  metrics: Record<string, number | null>;
  change: Record<string, number | null>;
  byChannel: { channel: string; totals: Record<string, number>; metrics: Record<string, number | null> }[];
}

const BASE: { key: string; label: string; money?: boolean }[] = [
  { key: "spend", label: "Chi phí", money: true },
  { key: "impressions", label: "Hiển thị" },
  { key: "clicks", label: "Lượt nhấp" },
  { key: "sessions", label: "Phiên truy cập" },
  { key: "leads", label: "Khách tiềm năng" },
  { key: "qualified_leads", label: "KH tiềm năng đủ ĐK" },
  { key: "customers", label: "Khách hàng mới" },
  { key: "revenue", label: "Doanh thu", money: true },
];

const DERIVED: { key: string; label: string; kind: "ratio" | "money" | "multiplier"; lowerIsBetter?: boolean }[] = [
  { key: "ctr", label: "CTR", kind: "ratio" },
  { key: "cpc", label: "CPC", kind: "money", lowerIsBetter: true },
  { key: "cpl", label: "CPL", kind: "money", lowerIsBetter: true },
  { key: "cpql", label: "CPQL", kind: "money", lowerIsBetter: true },
  { key: "cac", label: "CAC", kind: "money", lowerIsBetter: true },
  { key: "roas", label: "ROAS", kind: "multiplier" },
  { key: "cvr", label: "CVR", kind: "ratio" },
];

export function formatAnalyticsMoney(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "—";
  const major = currency === "USD" ? minor / 100 : minor;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "USD" ? 2 : 0 }).format(major);
}

function formatValue(value: number | null | undefined, kind: "count" | "ratio" | "money" | "multiplier", currency: string): string {
  if (value === null || value === undefined) return "—";
  if (kind === "money") return formatAnalyticsMoney(Math.round(value), currency);
  if (kind === "ratio") return `${(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
  if (kind === "multiplier") return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}×`;
  return value.toLocaleString("vi-VN");
}

function Change({ value, lowerIsBetter }: { value: number | null | undefined; lowerIsBetter?: boolean }) {
  if (value === null || value === undefined) return <span className="text-xs text-gray-400">—</span>;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const color = value === 0 ? "text-gray-500" : good ? "text-emerald-600" : "text-red-600";
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {value > 0 ? "▲" : value < 0 ? "▼" : "■"} {Math.abs(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export const AnalyticsOverviewPanel: React.FC<{ overview: AnalyticsOverviewLike }> = ({ overview }) => {
  const currency = overview.client.currency;
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        {overview.client.name}: {overview.period.from} → {overview.period.to} (so với {overview.previousPeriod.from} → {overview.previousPeriod.to})
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {BASE.map((b) => (
          <div key={b.key} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{b.label}</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{formatValue(overview.totals[b.key], b.money ? "money" : "count", currency)}</div>
            <Change value={overview.change[b.key]} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
        {DERIVED.map((d) => (
          <div key={d.key} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{d.label}</div>
            <div className="text-lg font-bold text-gray-900 mt-1">{formatValue(overview.metrics[d.key], d.kind, currency)}</div>
            <Change value={overview.change[d.key]} lowerIsBetter={d.lowerIsBetter} />
          </div>
        ))}
      </div>
      <Card title="Theo kênh">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-gray-500 text-left">
              <tr>
                <th className="py-2 pr-4">Kênh</th>
                <th className="py-2 pr-4 text-right">Chi phí</th>
                <th className="py-2 pr-4 text-right">Lượt nhấp</th>
                <th className="py-2 pr-4 text-right">Khách tiềm năng</th>
                <th className="py-2 pr-4 text-right">CPL</th>
                <th className="py-2 pr-4 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overview.byChannel.map((c) => (
                <tr key={c.channel}>
                  <td className="py-2 pr-4 font-medium text-gray-900">{c.channel}</td>
                  <td className="py-2 pr-4 text-right">{formatValue(c.totals.spend, "money", currency)}</td>
                  <td className="py-2 pr-4 text-right">{formatValue(c.totals.clicks, "count", currency)}</td>
                  <td className="py-2 pr-4 text-right">{formatValue(c.totals.leads, "count", currency)}</td>
                  <td className="py-2 pr-4 text-right">{formatValue(c.metrics.cpl, "money", currency)}</td>
                  <td className="py-2 pr-4 text-right">{formatValue(c.metrics.roas, "multiplier", currency)}</td>
                </tr>
              ))}
              {overview.byChannel.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-400">Chưa có dữ liệu trong kỳ này.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
