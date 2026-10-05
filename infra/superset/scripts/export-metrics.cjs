#!/usr/bin/env node
// Phase 19 — writes infra/superset/metrics/marketing-metrics.json from the authoritative metric
// registry (@nexus/utils analytics-metrics). Import these as dataset metrics on
// analytics.fact_marketing_daily so Superset uses exactly the API formulas.
// Usage: pnpm analytics:superset-metrics   (requires `pnpm --filter @nexus/utils build`)
const fs = require("fs");
const path = require("path");
const { toSupersetMetrics } = require("../../../packages/utils/dist/analytics-metrics");

const out = path.resolve(__dirname, "../metrics/marketing-metrics.json");
const doc = {
  dataset: "analytics.fact_marketing_daily",
  generatedFrom: "packages/utils/src/analytics-metrics.ts",
  note: "Generated file. Do not edit by hand; change the registry and re-run pnpm analytics:superset-metrics.",
  metrics: toSupersetMetrics(),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${doc.metrics.length} metrics to ${path.relative(process.cwd(), out)}`);
