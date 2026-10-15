// Extracts the HTTP surface of the NestJS API from controller decorators (no runtime needed).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2];
const OUT = process.argv[3];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/controllers?\.ts$/.test(name) && !name.endsWith(".spec.ts")) files.push(p);
  }
})(join(ROOT, "apps/api/src"));

const strings = (s) => [...s.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
const rows = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  let ctrl = null;
  let pending = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("@")) {
      // Collect a possibly multi-line decorator.
      let deco = line;
      let depth = (deco.match(/\(/g) || []).length - (deco.match(/\)/g) || []).length;
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        deco += " " + lines[i].trim();
        depth = (deco.match(/\(/g) || []).length - (deco.match(/\)/g) || []).length;
      }
      pending.push({ text: deco, line: i + 1 });
      continue;
    }
    if (/^export class \w+/.test(line)) {
      const name = line.match(/^export class (\w+)/)[1];
      const c = pending.find((d) => d.text.startsWith("@Controller"));
      if (c) {
        const guards = pending.filter((d) => d.text.startsWith("@UseGuards")).map((d) => d.text.replace(/^@UseGuards\(|\)$/g, ""));
        const feature = pending.find((d) => d.text.startsWith("@RequireFeature"));
        const perms = pending.find((d) => d.text.startsWith("@RequirePermissions"));
        ctrl = {
          name,
          paths: strings(c.text.replace(/^@Controller/, "")),
          guards: guards.join(", "),
          feature: feature ? strings(feature.text)[0] : "",
          perms: perms ? strings(perms.text) : [],
        };
      } else ctrl = null;
      pending = [];
      continue;
    }
    const methodMatch = line.match(/^(?:async\s+)?(\w+)\s*\(/);
    if (ctrl && methodMatch && pending.length) {
      const http = pending.find((d) => /^@(Get|Post|Put|Patch|Delete)\b/.test(d.text));
      if (http) {
        const verb = http.text.match(/^@(\w+)/)[1].toUpperCase();
        const sub = strings(http.text.replace(/^@\w+/, ""))[0] || "";
        const perms = pending.find((d) => d.text.startsWith("@RequirePermissions"));
        const guards = pending.filter((d) => d.text.startsWith("@UseGuards")).map((d) => d.text.replace(/^@UseGuards\(|\)$/g, ""));
        // Signature may span lines: read until the opening brace.
        let sig = lines[i];
        let j = i;
        while (!sig.includes("{") && j + 1 < lines.length) sig += " " + lines[++j];
        const body = sig.match(/@Body\(\)\s*\w+\??\s*:\s*([\w<>\[\]]+)/);
        const files = /@UploadedFiles?\(\)/.test(sig);
        const base = ctrl.paths.find((p) => p.startsWith("v1")) || ctrl.paths[0] || "";
        rows.push({
          file: relative(ROOT, file).replace(/\\/g, "/"),
          line: http.line,
          controller: ctrl.name,
          method: verb,
          path: "/" + [base, sub].filter(Boolean).join("/").replace(/\/+/g, "/"),
          aliases: ctrl.paths.filter((p) => p !== base).map((p) => "/" + [p, sub].filter(Boolean).join("/")),
          guards: [ctrl.guards, ...guards].filter(Boolean).join(", ") || "—",
          permissions: (perms ? strings(perms.text) : ctrl.perms).join(" + ") || "—",
          feature: ctrl.feature,
          input: [body ? body[1] : "", files ? "multipart" : ""].filter(Boolean).join(" + ") || "—",
          handler: methodMatch[1],
        });
      }
      pending = [];
    } else if (!line.startsWith("@") && line !== "" && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*")) {
      if (!methodMatch) pending = pending.filter(() => false);
    }
  }
}
rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(`routes=${rows.length} controllers=${new Set(rows.map((r) => r.controller)).size} files=${files.length}`);
