import {
  BASE_MEASURES,
  DERIVED_METRICS,
  FORBIDDEN_CLIENT_KPI_FIELDS,
  computeDerivedMetrics,
  emptyBaseMeasures,
  percentChange,
  sumBaseMeasures,
  toSupersetMetrics,
} from "./analytics-metrics";

describe("analytics metric registry", () => {
  const base = { spend: 1_000_000, impressions: 50_000, clicks: 1_000, sessions: 2_000, leads: 50, qualified_leads: 20, customers: 5, revenue: 4_000_000 };

  it("computes every derived metric from base measures", () => {
    const m = computeDerivedMetrics(base);
    expect(m.ctr).toBe(0.02);
    expect(m.cpc).toBe(1000);
    expect(m.cpl).toBe(20000);
    expect(m.cpql).toBe(50000);
    expect(m.cac).toBe(200000);
    expect(m.roas).toBe(4);
    expect(m.cvr).toBe(0.0025);
  });

  it("returns null instead of Infinity/NaN on division by zero", () => {
    const m = computeDerivedMetrics(emptyBaseMeasures());
    for (const d of DERIVED_METRICS) expect(m[d.key]).toBeNull();
  });

  it("recomputes ratios from sums rather than averaging ratios", () => {
    const total = sumBaseMeasures([
      { clicks: 1, impressions: 100 },
      { clicks: 99, impressions: 900 },
    ]);
    // average of ratios would be (0.01 + 0.11) / 2 = 0.06; the correct CTR is 100 / 1000
    expect(computeDerivedMetrics(total).ctr).toBe(0.1);
  });

  it("percentChange handles zero and null baselines", () => {
    expect(percentChange(150, 100)).toBe(0.5);
    expect(percentChange(50, 100)).toBe(-0.5);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
  });

  it("exports Superset metrics for every base and derived metric, guarded with NULLIF", () => {
    const metrics = toSupersetMetrics();
    expect(metrics).toHaveLength(BASE_MEASURES.length + DERIVED_METRICS.length);
    const roas = metrics.find((m) => m.metric_name === "roas");
    expect(roas?.expression).toBe("SUM(revenue_minor)::numeric / NULLIF(SUM(spend_minor), 0)");
  });

  it("lists every derived KPI as forbidden in connector payloads", () => {
    for (const d of DERIVED_METRICS) expect(FORBIDDEN_CLIENT_KPI_FIELDS).toContain(d.key);
  });
});
