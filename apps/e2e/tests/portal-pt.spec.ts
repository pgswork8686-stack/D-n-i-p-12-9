import { test, expect, API_URL } from "./fixtures";

/**
 * Customer Portal against the real API and database. Signs in with the development bearer
 * token the API accepts outside production (Portal must run with NEXT_PUBLIC_DEV_AUTH_ENABLED=true).
 * Stateful tests only run on the desktop project so a three-viewport run creates data once.
 */
const PORTAL_URL = process.env.E2E_PORTAL_URL || "http://localhost:3001";
const CUSTOMER_TOKEN = "dev-customer-token";
const ADMIN_TOKEN = "dev-admin-token";

test.use({ baseURL: PORTAL_URL });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => window.localStorage.setItem("nexus_portal_token", token), CUSTOMER_TOKEN);
});

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const desktopOnly = (name: string) => name === "desktop-1440";

const PAGES: { path: string; heading: RegExp }[] = [
  { path: "/", heading: /Chào/ },
  { path: "/entitlements", heading: /^Sản phẩm của tôi$/ },
  { path: "/downloads", heading: /^Trung tâm tải xuống$/ },
  { path: "/licenses", heading: /^License của tôi$/ },
  { path: "/allocations", heading: /^Kích hoạt tên miền$/ },
  { path: "/orders", heading: /^Đơn hàng của tôi$/ },
  { path: "/tickets", heading: /^Yêu cầu hỗ trợ$/ },
  { path: "/notifications", heading: /^Thông báo/ },
  { path: "/account", heading: /^Thông tin cá nhân$/ },
];

test.describe("Portal PT01–PT13 tiếng Việt, không tràn ngang", () => {
  for (const { path, heading } of PAGES) {
    test(`${path} hiển thị tiêu đề tiếng Việt và vừa khung hình`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} tràn ngang ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("PT08 Đơn hàng", () => {
  test("lists real orders, filters by status and opens an order", async ({ page }) => {
    await page.goto("/orders");
    await expect(page.getByRole("columnheader", { name: "Mã đơn" }).or(page.getByText(/NXS-\d{4}-\d+/).first())).toBeVisible();
    await page.getByLabel("Lọc theo trạng thái").selectOption("PAID");
    const first = page.getByRole("link", { name: "Xem" }).first();
    test.skip((await first.count()) === 0, "Không có đơn hàng đã thanh toán trong dữ liệu thử");
    await first.click();
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: /^Đơn hàng / })).toBeVisible();
  });
});

test.describe("PT10–PT11 Hỗ trợ", () => {
  test("customer opens a ticket, sees staff reply but never the internal note", async ({ page }, info) => {
    test.skip(!desktopOnly(info.project.name), "Ticket được tạo một lần ở dự án desktop");
    const subject = `E2E PT10 ${Date.now()}`;
    await page.goto("/tickets");
    await page.getByRole("button", { name: /Tạo yêu cầu mới/ }).click();
    const dialog = page.locator("form").filter({ hasText: "Tiêu đề" });
    await dialog.getByPlaceholder(/Không kích hoạt được license/).fill(subject);
    await dialog.locator("textarea").fill("Mình cần hỗ trợ kích hoạt license.");
    await dialog.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await expect(page.getByText(/Đã tạo yêu cầu /)).toBeVisible();

    const mine = await api<{ items: { id: string; subject: string }[] }>("/tickets?limit=50", CUSTOMER_TOKEN);
    const ticket = mine.items.find((t) => t.subject === subject);
    expect(ticket, "ticket vừa tạo phải có trong API").toBeTruthy();

    await api(`/admin/tickets/${ticket!.id}/reply`, ADMIN_TOKEN, { method: "POST", body: JSON.stringify({ body: "Chào bạn, bên mình đã nhận yêu cầu.", isInternalNote: false }) });
    await api(`/admin/tickets/${ticket!.id}/reply`, ADMIN_TOKEN, { method: "POST", body: JSON.stringify({ body: "Ghi chú nội bộ bí mật", isInternalNote: true }) });

    await page.goto(`/tickets/${ticket!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
    await expect(page.getByText("Chào bạn, bên mình đã nhận yêu cầu.")).toBeVisible();
    await expect(page.getByText("Nhân viên hỗ trợ")).toBeVisible();
    await expect(page.getByText("Ghi chú nội bộ bí mật")).toHaveCount(0);

    await page.getByPlaceholder(/Nhập phản hồi/).fill("Cảm ơn, mình đã thử lại.");
    await page.getByRole("button", { name: "Gửi phản hồi" }).click();
    await expect(page.getByText("Cảm ơn, mình đã thử lại.")).toBeVisible();
  });

  test("a customer cannot open another customer's ticket", async ({ page }) => {
    // A ticket owned by a different account (the admin dev user), created through the public endpoint.
    const foreign = await api<{ id: string }>("/tickets", ADMIN_TOKEN, { method: "POST", body: JSON.stringify({ subject: `E2E isolation ${Date.now()}`, body: "Ticket của tài khoản khác", category: "GENERAL" }) });
    await page.goto(`/tickets/${foreign.id}`);
    await expect(page.getByText(/Không mở được yêu cầu|không có quyền/)).toBeVisible();
  });
});

test.describe("PT05–PT06 License", () => {
  test("never prints a full key in the list and reveals it only on demand", async ({ page }) => {
    await page.goto("/licenses");
    await expect(page.getByRole("heading", { level: 1, name: "License của tôi" })).toBeVisible();
    const view = page.getByRole("link", { name: "Xem chi tiết" }).first();
    test.skip((await view.count()) === 0, "Khách thử không có license");
    expect(await page.locator("main").innerText()).not.toMatch(/NXS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    await view.click();
    await expect(page.getByRole("button", { name: "Hiện license key" })).toBeVisible();
    await page.getByRole("button", { name: "Hiện license key" }).click();
    await expect(page.getByRole("button", { name: "Ẩn license key" })).toBeVisible();
    await page.getByRole("button", { name: "Ẩn license key" }).click();
    await expect(page.getByRole("button", { name: "Hiện license key" })).toBeVisible();
  });
});

test.describe("Bảo vệ truy cập", () => {
  test("without a token the portal sends visitors to the Vietnamese sign-in", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: PORTAL_URL });
    const page = await ctx.newPage();
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tài khoản khách hàng");
    await ctx.close();
  });
});
