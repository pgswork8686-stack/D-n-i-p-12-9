// Runtime UI verification for the Services Foundation screens (real API + next dev).
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA = process.env.SHA || "unknown";
const ids = JSON.parse(readFileSync(new URL("./demo-ids.json", import.meta.url), "utf8"));
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const WEB = "http://localhost:3000";
const PORTAL = "http://localhost:3001";
const ADMIN = "http://localhost:3002";

const screens = [
  { id: "web-services", url: `${WEB}/services`, viewports: [1440, 768, 390], expectText: "Custom Web App Development" },
  { id: "web-service-detail", url: `${WEB}/services/custom-web-app-development`, viewports: [1440, 768, 390], expectText: "Gửi yêu cầu dự án" },
  { id: "portal-services", url: `${PORTAL}/services`, viewports: [1440, 768, 390], expectText: "Phần mềm quản lý kho" },
  {
    id: "portal-project-detail",
    url: `${PORTAL}/services/projects/${ids.projectId}`,
    viewports: [1440, 768, 390],
    expectText: "Khảo sát & thiết kế",
    mustNotContain: ["Ghi chú nội bộ", "120 giờ công", "Dự toán nội bộ.pdf"],
  },
  {
    id: "portal-inquiry-detail",
    url: `${PORTAL}/services/inquiries/${ids.mainInquiryId}`,
    viewports: [1440, 768, 390],
    expectText: "Cần phần mềm quản lý kho",
    // The staff note is internal: it must never reach the customer view.
    mustNotContain: ["Khách đã xác nhận phạm vi qua điện thoại"],
  },
  { id: "admin-services", url: `${ADMIN}/services`, viewports: [1440, 768, 390], expectText: "Custom Web App Development" },
  { id: "admin-projects", url: `${ADMIN}/service-projects`, viewports: [1440, 768, 390], expectText: "Phần mềm quản lý kho" },
  { id: "admin-inquiries", url: `${ADMIN}/service-inquiries`, viewports: [1440, 768, 390], expectText: "Shop Thời Trang Lan Anh" },
  { id: "admin-inquiry-detail", url: `${ADMIN}/service-inquiries/${ids.mainInquiryId}`, viewports: [1440, 768, 390], expectText: "Công ty TNHH Minh An" },
  { id: "admin-project-detail", url: `${ADMIN}/service-projects/${ids.projectId}`, viewports: [1440, 768, 390], expectText: "Dự toán nội bộ.pdf" },
];

const VIEWPORT_HEIGHT = { 1440: 900, 768: 1024, 390: 844 };
const results = [];

const browser = await chromium.launch();
async function newContext(width) {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT[width] }, locale: "vi-VN" });
  // Dev-only auth: the apps restore these tokens when NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS=true and Supabase is unset.
  await context.addInitScript(() => {
    localStorage.setItem("nexus_portal_token", "dev-customer-token");
    localStorage.setItem("nexus_admin_token", "dev-admin-token");
  });
  return context;
}

async function inspect(page, screen, width, consoleErrors, failedApi) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    h1: document.querySelectorAll("h1").length,
    text: document.body.innerText,
  }));
  const leaks = (screen.mustNotContain || []).filter((t) => metrics.text.includes(t));
  return {
    screen: screen.id,
    url: screen.url.replace(/[0-9a-f-]{36}/g, ":id"),
    viewport: width,
    horizontalOverflow: metrics.scrollWidth > metrics.innerWidth + 1,
    scrollWidth: metrics.scrollWidth,
    h1Count: metrics.h1,
    expectedTextFound: metrics.text.includes(screen.expectText),
    internalLeaks: leaks,
    consoleErrors: [...consoleErrors],
    failedApiRequests: [...failedApi],
  };
}

for (const screen of screens) {
  for (const width of screen.viewports) {
    const context = await newContext(width);
    const page = await context.newPage();
    const consoleErrors = [];
    const failedApi = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("response", (r) => {
      if (r.url().startsWith("http://localhost:4000") && r.status() >= 400) failedApi.push(`${r.status()} ${r.url().replace(/[0-9a-f-]{36}/g, ":id")}`);
    });
    await page.goto(screen.url, { waitUntil: "networkidle", timeout: 180000 });
    await page.getByText(screen.expectText, { exact: false }).first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500);
    const r = await inspect(page, screen, width, consoleErrors, failedApi);
    r.file = `${screen.id}-${width}-${SHA}.png`;
    await page.screenshot({ path: fileURLToPath(new URL(r.file, OUT)), fullPage: true });
    results.push(r);
    console.log(JSON.stringify(r));
    await context.close();
  }
}

// Inquiry form: validation state and a real anonymous submission (stored by the API).
for (const width of [1440, 768, 390]) {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT[width] }, locale: "vi-VN" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  await page.goto(`${WEB}/services/api-integration`, { waitUntil: "networkidle", timeout: 180000 });
  const form = page.locator("#inquiry");
  await form.scrollIntoViewIfNeeded();
  await form.screenshot({ path: fileURLToPath(new URL(`web-inquiry-form-empty-${width}-${SHA}.png`, OUT)) });
  await page.fill("#inq-company", "Công ty Kiểm Thử UI");
  await page.fill("#inq-name", "Lê Kiểm Thử");
  await page.fill("#inq-email", `ui-check-${width}@example.com`);
  await page.fill("#inq-req", "Tích hợp API hóa đơn điện tử với phần mềm bán hàng hiện có.");
  await page.selectOption("#inq-budget", "FROM_20M_TO_50M");
  const submit = page.getByRole("button", { name: /Nhận báo giá|Gửi/ }).last();
  const responsePromise = page.waitForResponse((r) => r.url().endsWith("/v1/service-inquiries") && r.request().method() === "POST");
  await submit.click();
  const response = await responsePromise;
  await page.getByText("Đã nhận yêu cầu").waitFor({ timeout: 30000 });
  await form.screenshot({ path: fileURLToPath(new URL(`web-inquiry-form-submitted-${width}-${SHA}.png`, OUT)) });
  const r = {
    screen: "web-inquiry-form-submit",
    url: "/services/api-integration#inquiry",
    viewport: width,
    submitStatus: response.status(),
    successShown: await page.getByText("Đã nhận yêu cầu").isVisible(),
    consoleErrors,
    file: `web-inquiry-form-submitted-${width}-${SHA}.png`,
  };
  results.push(r);
  console.log(JSON.stringify(r));
  await context.close();
}

await browser.close();
writeFileSync(new URL(`./ui-results-${SHA}.json`, import.meta.url), JSON.stringify(results, null, 2));
const problems = results.filter(
  (r) => r.horizontalOverflow || r.expectedTextFound === false || (r.internalLeaks && r.internalLeaks.length) || (r.consoleErrors && r.consoleErrors.length) || (r.submitStatus && r.submitStatus !== 201),
);
console.log(`UI_CHECKS_DONE total=${results.length} problems=${problems.length}`);
