/**
 * Phase 19 — authoritative marketing metric registry.
 *
 * Base measures are additive sums stored in the warehouse (analytics.fact_*). Derived metrics
 * (CTR, CPC, ROAS...) are NEVER stored and NEVER accepted from connectors: they are computed
 * here, from summed base measures, by the API, the AI workflows and (through `toSupersetMetrics`)
 * the Superset semantic layer. Frontends display the values returned by the API and must not
 * re-implement these formulas.
 *
 * Division by zero yields `null` (not 0, not Infinity) so dashboards can show "—".
 * Money measures are integer minor units (VND has no minor unit, USD uses cents).
 */

export const BASE_MEASURES = [
  "spend",
  "impressions",
  "clicks",
  "sessions",
  "leads",
  "qualified_leads",
  "customers",
  "revenue",
] as const;

export type BaseMeasure = (typeof BASE_MEASURES)[number];
export type BaseMeasures = Record<BaseMeasure, number>;

export type DerivedMetricKey = "ctr" | "cpc" | "cpl" | "cpql" | "cac" | "roas" | "cvr";

export interface DerivedMetricDefinition {
  key: DerivedMetricKey;
  label: string;
  /** How the value should be formatted by clients. */
  unit: "ratio" | "money" | "multiplier";
  numerator: BaseMeasure;
  denominator: BaseMeasure;
  /** Human-readable formula, also used in docs and the Superset export. */
  formula: string;
  /** Higher is better (true) or lower is better (false); used by anomaly detection. */
  higherIsBetter: boolean;
  description: string;
}

/** Column name of each base measure in analytics.fact_marketing_daily. */
export const BASE_MEASURE_COLUMNS: Record<BaseMeasure, string> = {
  spend: "spend_minor",
  impressions: "impressions",
  clicks: "clicks",
  sessions: "sessions",
  leads: "leads",
  qualified_leads: "qualified_leads",
  customers: "customers",
  revenue: "revenue_minor",
};

export const DERIVED_METRICS: readonly DerivedMetricDefinition[] = [
  { key: "ctr", label: "CTR", unit: "ratio", numerator: "clicks", denominator: "impressions", formula: "clicks / impressions", higherIsBetter: true, description: "Tỷ lệ nhấp: số lượt nhấp trên số lần hiển thị." },
  { key: "cpc", label: "CPC", unit: "money", numerator: "spend", denominator: "clicks", formula: "spend / clicks", higherIsBetter: false, description: "Chi phí mỗi lượt nhấp." },
  { key: "cpl", label: "CPL", unit: "money", numerator: "spend", denominator: "leads", formula: "spend / leads", higherIsBetter: false, description: "Chi phí mỗi khách hàng tiềm năng." },
  { key: "cpql", label: "CPQL", unit: "money", numerator: "spend", denominator: "qualified_leads", formula: "spend / qualified_leads", higherIsBetter: false, description: "Chi phí mỗi khách hàng tiềm năng đủ điều kiện." },
  { key: "cac", label: "CAC", unit: "money", numerator: "spend", denominator: "customers", formula: "spend / customers", higherIsBetter: false, description: "Chi phí để có một khách hàng mới." },
  { key: "roas", label: "ROAS", unit: "multiplier", numerator: "revenue", denominator: "spend", formula: "revenue / spend", higherIsBetter: true, description: "Doanh thu trên mỗi đồng chi quảng cáo." },
  { key: "cvr", label: "CVR", unit: "ratio", numerator: "customers", denominator: "sessions", formula: "customers / sessions", higherIsBetter: true, description: "Tỷ lệ chuyển đổi: khách hàng mới trên số phiên truy cập." },
] as const;

export type DerivedMetrics = Record<DerivedMetricKey, number | null>;

const ROUND_DIGITS = 6;

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  const value = numerator / denominator;
  return Math.round(value * 10 ** ROUND_DIGITS) / 10 ** ROUND_DIGITS;
}

export function emptyBaseMeasures(): BaseMeasures {
  return { spend: 0, impressions: 0, clicks: 0, sessions: 0, leads: 0, qualified_leads: 0, customers: 0, revenue: 0 };
}

/** Sums rows of base measures (ratios must be recomputed from sums, never averaged). */
export function sumBaseMeasures(rows: Partial<BaseMeasures>[]): BaseMeasures {
  const total = emptyBaseMeasures();
  for (const row of rows) {
    for (const m of BASE_MEASURES) total[m] += Number(row[m] ?? 0);
  }
  return total;
}

export function computeDerivedMetrics(base: BaseMeasures): DerivedMetrics {
  const result = {} as DerivedMetrics;
  for (const def of DERIVED_METRICS) {
    result[def.key] = safeDivide(base[def.numerator], base[def.denominator]);
  }
  return result;
}

/** Relative change from `previous` to `current` (0.25 = +25%); null when not comparable. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return safeDivide(current - previous, Math.abs(previous));
}

/**
 * Superset "metrics" definitions generated from the registry (SQL expressions over
 * analytics.fact_marketing_daily). Keeps Superset dashboards on the same formulas as the API.
 */
export function toSupersetMetrics(): { metric_name: string; verbose_name: string; expression: string; description: string }[] {
  const sum = (m: BaseMeasure) => `SUM(${BASE_MEASURE_COLUMNS[m]})`;
  const base = BASE_MEASURES.map((m) => ({
    metric_name: m,
    verbose_name: m,
    expression: sum(m),
    description: `Tổng ${m}`,
  }));
  const derived = DERIVED_METRICS.map((d) => ({
    metric_name: d.key,
    verbose_name: d.label,
    expression: `${sum(d.numerator)}::numeric / NULLIF(${sum(d.denominator)}, 0)`,
    description: `${d.description} (${d.formula})`,
  }));
  return [...base, ...derived];
}

/** Field names a connector must never send: derived KPIs are always computed server-side. */
export const FORBIDDEN_CLIENT_KPI_FIELDS: readonly string[] = [
  ...DERIVED_METRICS.map((d) => d.key),
  "conversion_rate",
  "conversionRate",
  "cost_per_lead",
  "costPerLead",
  "cost_per_click",
  "costPerClick",
  "return_on_ad_spend",
  "returnOnAdSpend",
];
