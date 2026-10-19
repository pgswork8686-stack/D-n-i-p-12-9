#!/usr/bin/env node
// Fails when a Playwright JSON report contains a skip that is not tied to the project (viewport).
// Specs skip by design when a test must run once on desktop, or only on the phone viewport. Any
// other skip (for example "no data in the test database") means the scenario was NOT exercised,
// which must not pass CI silently.
//
// Usage: node infra/scripts/e2e-skip-audit.mjs <report.json> [<report.json> ...]
import * as fs from "node:fs";

const ALLOWED = [/dự án desktop/i, /viewport điện thoại/i];

const offending = [];
let total = 0;
let skipped = 0;

function walk(suite, file) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      total += 1;
      const isSkipped = t.status === "skipped" || (t.results ?? []).every((r) => r.status === "skipped");
      if (!isSkipped) continue;
      skipped += 1;
      const reasons = (t.annotations ?? []).filter((a) => a.type === "skip").map((a) => a.description ?? "");
      if (reasons.length === 0 || !reasons.every((r) => ALLOWED.some((re) => re.test(r)))) {
        offending.push(`${file} › ${spec.title} [${t.projectName}] — ${reasons.join("; ") || "no reason given"}`);
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, file);
}

for (const path of process.argv.slice(2)) {
  const report = JSON.parse(fs.readFileSync(path, "utf8"));
  for (const suite of report.suites ?? []) walk(suite, suite.file ?? suite.title);
}

console.log(`skip audit: ${total} tests, ${skipped} skipped, ${offending.length} not allowed`);
if (total === 0) {
  console.error("skip audit: the reports contain no tests");
  process.exit(1);
}
if (offending.length > 0) {
  for (const line of offending) console.error(`NOT EXERCISED: ${line}`);
  process.exit(1);
}
