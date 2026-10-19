// Dev helper: screenshots portal pages with the dev customer token (not part of the test suite).
import { chromium } from "@playwright/test";
import fs from "node:fs";
const out = process.argv[2];
const paths = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const API = process.env.E2E_API_URL || "http://localhost:4000";
const orders = await (await fetch(`${API}/orders?limit=20`, { headers: { Authorization: "Bearer dev-customer-token" } })).json();
const paid = orders.items.find((o) => o.status === "PAID" && o.payments?.length) || orders.items[0];
for (const [name, vp] of [["d", { width: 1440, height: 900 }], ["m", { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: name === "m", hasTouch: name === "m", locale: "vi-VN" });
  await ctx.addInitScript(() => localStorage.setItem("nexus_portal_token", "dev-customer-token"));
  const page = await ctx.newPage();
  for (const p of paths) {
    const url = "http://localhost:3001" + p.replace("{PAID}", paid.id);
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const file = `${out}/${name}-${p.replace(/[^a-z0-9]+/gi, "_")}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await ctx.close();
}
await b.close();
