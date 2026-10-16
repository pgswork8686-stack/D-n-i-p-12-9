import { test as base, expect, type Page } from "@playwright/test";

/** API base the test process uses to read real data (not the browser). */
export const API_URL = process.env.E2E_API_URL || "http://localhost:4000";

/**
 * Optional origin rewrites for when the browser runs in a container while the
 * page references host origins, e.g.
 * E2E_REWRITE="http://localhost:4000=http://web-stack:4000,http://localhost:9232=http://host.docker.internal:9232"
 */
const REWRITES = (process.env.E2E_REWRITE || "")
  .split(",")
  .map((pair) => pair.split("="))
  .filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][];

type Fixtures = { consoleErrors: string[] };

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    for (const [from, to] of REWRITES) {
      await page.route(`${from}/**`, (route) => route.continue({ url: route.request().url().replace(from, to) }));
    }
    await use(page);
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await use(errors);
  },
});

export { expect };

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Scroll the whole page so lazy images load, then return to the top. */
export async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
}
