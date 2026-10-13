import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against an already running stack: web (E2E_BASE_URL) + API
 * (E2E_API_URL) seeded with `pnpm --filter @nexus/e2e seed:demo`.
 * See apps/e2e/README.md.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results/report.json" }]],
  outputDir: "results/artifacts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    locale: "vi-VN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
