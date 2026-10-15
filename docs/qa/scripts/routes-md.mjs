// Renders the extracted route inventory (non-Services modules) as markdown tables grouped by module.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const [routesPath, repoRoot, outPath] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(routesPath, "utf8")).filter((r) => !r.file.includes("/modules/services/"));

const actorOf = (r) => {
  if (r.guards.includes("PermissionsGuard")) return "Staff";
  if (r.guards.includes("AutomationHmacGuard")) return "Hệ thống (HMAC n8n)";
  if (r.guards.includes("AuthGuard")) return "Đã đăng nhập (sở hữu)";
  if (r.path.includes("/webhooks/")) return "Cổng thanh toán (xác thực trong handler)";
  if (/\/licenses\/(activate|validate|deactivate)|\/updates\/check/.test(r.path)) return "Plugin trên site khách (license key)";
  if (r.path.includes("/health") || r.path.includes("/queue")) return "Vận hành";
  return "Public";
};
const errorsOf = (r) => {
  const e = ["400 (DTO)"];
  if (r.guards.includes("AuthGuard")) e.push("401");
  if (r.guards.includes("PermissionsGuard")) e.push("403");
  if (r.guards.includes("AutomationHmacGuard")) e.push("401 (HMAC)");
  if (r.feature) e.push(`404 khi FEATURE_${r.feature.toUpperCase()} tắt`);
  return e.join(", ");
};
const moduleOf = (r) => r.file.split("/")[4];
const specCount = (mod) => readdirSync(`${repoRoot}/apps/api/src/modules/${mod}`).filter((f) => f.endsWith(".spec.ts")).length;
const ACCEPTANCE = {
  cart: "phase 4", orders: "phase 4", payments: "phase 4, 9", entitlements: "phase 5", allocations: "phase 6",
  licenses: "phase 7", downloads: "phase 8", catalog: "phase 4, 17", content: "phase 11", automation: "phase 12",
  affiliates: "phase 13", subscriptions: "phase 13", hosting: "phase 14", tickets: "phase 15", finance: "phase 16",
  users: "phase 4–5 (dev users)", auth: "mọi phase", health: "phase 18", queue: "worker smoke",
};

const byModule = new Map();
for (const r of rows) {
  const m = moduleOf(r);
  if (!byModule.has(m)) byModule.set(m, []);
  byModule.get(m).push(r);
}

let md = "";
for (const [mod, list] of [...byModule.entries()].sort()) {
  md += `\n#### ${mod} (${list.length} route · unit: ${specCount(mod)} file spec · acceptance: ${ACCEPTANCE[mod] || "—"})\n\n`;
  md += "| API | Method | Actor | Permission | Input | Output | Errors | Test |\n|---|---|---|---|---|---|---|---|\n";
  for (const r of list) {
    const alias = r.aliases.length ? ` (alias ${r.aliases.map((a) => `\`${a}\``).join(", ")})` : "";
    const link = `[${r.handler}](../../${r.file}#L${r.line})`;
    md += `| \`${r.path}\`${alias} | ${r.method} | ${actorOf(r)} | ${r.permissions === "—" ? "—" : `\`${r.permissions}\``} | ${r.input === "—" ? "—" : `\`${r.input}\``} | xem ${link} | ${errorsOf(r)} | unit module · ${ACCEPTANCE[mod] || "—"} |\n`;
  }
}
writeFileSync(outPath, md);
console.log(`modules=${byModule.size} rows=${rows.length}`);
