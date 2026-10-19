import crypto from "node:crypto";
import { test, expect, API_URL } from "./fixtures";

/**
 * One purchase across the three apps and the real backend:
 *   Storefront (cart → checkout → order) → signed payment callback → Portal (order, entitlement,
 *   masked license) → Admin (order detail, entitlements).
 * Needs: API with ENABLE_TEST_PAYMENT_PROVIDER=true and TEST_PAYMENT_WEBHOOK_SECRET; the worker running (it issues entitlements and licenses from the ORDER_PAID outbox event); Storefront,
 * Portal and Admin running in dev mode with their dev-auth flags (NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS /
 * NEXT_PUBLIC_DEV_AUTH_ENABLED=true). Runs once, on the desktop project only: it creates a real order.
 */
const WEB_URL = process.env.E2E_WEB_URL || "http://localhost:3000";
const PORTAL_URL = process.env.E2E_PORTAL_URL || "http://localhost:3001";
const ADMIN_URL = process.env.E2E_ADMIN_URL || "http://localhost:3002";
const WEBHOOK_SECRET = process.env.TEST_PAYMENT_WEBHOOK_SECRET || "ci-test-payment-secret";
const CUSTOMER = "dev-customer-token";
const ADMIN = "dev-admin-token";
const PRODUCT_SLUG = process.env.E2E_PURCHASE_SLUG || "klinmart";

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

test.describe.configure({ mode: "serial" });

test.describe("Luồng mua hàng Storefront → API → Portal → Admin", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop-1440", "Tạo đơn thật, chỉ chạy một lần ở dự án desktop");
  });

  let orderId = "";
  let orderNumber = "";
  let productName = "";

  test("Storefront: thêm vào giỏ, thanh toán và nhận đơn chờ thanh toán", async ({ browser }) => {
    await api("/cart", CUSTOMER, { method: "DELETE" }).catch(() => undefined); // start from an empty cart
    const ctx = await browser.newContext({ baseURL: WEB_URL, locale: "vi-VN" });
    await ctx.addInitScript(() => window.localStorage.setItem("nexus_web_dev_token", "dev-customer-token"));
    const page = await ctx.newPage();

    await page.goto(`/products/${PRODUCT_SLUG}`);
    productName = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
    await expect(page.getByRole("button", { name: "Thêm vào giỏ hàng" })).toBeEnabled();
    await page.getByRole("button", { name: "Thêm vào giỏ hàng" }).click();
    await expect(page.getByText("Đã thêm vào giỏ").first()).toBeVisible();

    await page.goto("/cart");
    await expect(page.getByRole("heading", { level: 1, name: "Giỏ hàng" })).toBeVisible();
    await expect(page.getByText(productName).first()).toBeVisible();

    await page.goto("/checkout");
    await expect(page.getByRole("heading", { level: 1, name: "Thanh toán" })).toBeVisible();
    await page.getByRole("radio", { name: /Cổng thử nghiệm/ }).check();
    await page.getByRole("button", { name: /Đặt hàng/ }).click();

    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 30_000 });
    orderId = page.url().match(/\/orders\/([0-9a-f-]{36})/)![1];

    const order = await api<{ orderNumber: string; status: string }>(`/orders/${orderId}`, CUSTOMER);
    orderNumber = order.orderNumber;
    expect(order.status, "chưa thanh toán thì đơn phải ở trạng thái chờ").toBe("PENDING_PAYMENT");
    await ctx.close();
  });

  test("Backend: callback thanh toán có chữ ký chuyển đơn sang PAID, chữ ký sai bị từ chối", async () => {
    const order = await api<{ payments: { id: string; status: string }[] }>(`/orders/${orderId}`, CUSTOMER);
    const payment = order.payments.find((p) => p.status !== "SUCCEEDED");
    expect(payment, "đơn phải có một lượt thanh toán đang chờ").toBeTruthy();

    const eventId = `evt_e2e_${Date.now()}`;
    const body = JSON.stringify({ paymentId: payment!.id, externalEventId: eventId, eventType: "payment.succeeded" });

    const forged = await fetch(`${API_URL}/payments/test-callback`, {
      method: "POST", body,
      headers: { "Content-Type": "application/json", "x-test-signature": "0".repeat(64) },
    });
    expect(forged.status, "chữ ký sai không được chấp nhận").toBeGreaterThanOrEqual(400);
    expect((await api<{ status: string }>(`/orders/${orderId}`, CUSTOMER)).status).toBe("PENDING_PAYMENT");

    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${eventId}:${payment!.id}:payment.succeeded`).digest("hex");
    const ok = await fetch(`${API_URL}/payments/test-callback`, {
      method: "POST", body, headers: { "Content-Type": "application/json", "x-test-signature": signature },
    });
    expect(ok.ok, await ok.text()).toBe(true);
    const replay = await fetch(`${API_URL}/payments/test-callback`, {
      method: "POST", body, headers: { "Content-Type": "application/json", "x-test-signature": signature },
    });
    expect(replay.status, "gửi lại cùng sự kiện không được gây lỗi 5xx").toBeLessThan(500);

    await expect.poll(async () => (await api<{ status: string }>(`/orders/${orderId}`, CUSTOMER)).status, { timeout: 30_000 }).toBe("PAID");
  });

  test("Portal: đơn đã thanh toán, có quyền sử dụng và license bị che", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: PORTAL_URL, locale: "vi-VN" });
    await ctx.addInitScript(() => window.localStorage.setItem("nexus_portal_token", "dev-customer-token"));
    const page = await ctx.newPage();

    // Entitlements and licenses are issued asynchronously by the worker from the ORDER_PAID outbox event.
    await expect.poll(async () => {
      const list = await api<{ items: { orderId: string }[] }>("/entitlements?limit=100", CUSTOMER);
      return list.items.some((e) => e.orderId === orderId);
    }, { timeout: 60_000, message: "worker chưa cấp quyền sử dụng (worker có đang chạy không?)" }).toBe(true);

    await page.goto(`/orders/${orderId}`);
    await expect(page.getByRole("heading", { level: 1, name: `Đơn hàng ${orderNumber}` })).toBeVisible();
    await expect(page.getByText("Quyền sử dụng đã sẵn sàng")).toBeVisible();

    await page.goto("/orders");
    await page.getByLabel("Tìm theo mã đơn").fill(orderNumber);
    await expect(page.getByRole("row", { name: new RegExp(orderNumber) }).getByText("Đã thanh toán")).toBeVisible();

    await page.goto("/entitlements");
    await expect(page.getByRole("heading", { level: 2, name: productName }).first()).toBeVisible();

    const licenses = await api<{ id: string; keyMasked: string }[]>("/licenses", CUSTOMER);
    expect(licenses.length).toBeGreaterThan(0);
    await page.goto("/licenses");
    await expect(page.getByRole("heading", { level: 1, name: "License của tôi" })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    await ctx.close();
  });

  test("Admin: nhân viên thấy đơn đã thanh toán và quyền sử dụng của khách", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: ADMIN_URL, locale: "vi-VN" });
    await ctx.addInitScript(() => window.localStorage.setItem("nexus_admin_token", "dev-admin-token"));
    const page = await ctx.newPage();

    await page.goto(`/admin/orders/${orderId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Chi tiết đơn hàng" })).toBeVisible();
    await expect(page.getByText(orderNumber).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Thanh toán" })).toBeVisible();

    const adminOrder = await api<{ status: string }>(`/admin/orders/${orderId}`, ADMIN);
    expect(adminOrder.status).toBe("PAID");

    await page.goto("/admin/entitlements");
    await expect(page.getByRole("heading", { level: 1, name: /Quyền sử dụng/ })).toBeVisible();
    await ctx.close();
  });
});
