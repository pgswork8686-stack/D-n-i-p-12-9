import http from "node:http";
import { test, expect, API_URL } from "./fixtures";

/**
 * AD10 Đối soát thanh toán against the real API and database.
 * Needs the API started with SePay configured:
 *   SEPAY_BANK_CODE, SEPAY_BANK_ACCOUNT=0123456789, SEPAY_WEBHOOK_API_KEY (>= 24 chars),
 *   SEPAY_API_TOKEN and SEPAY_API_BASE_URL=http://localhost:4568 (this spec serves a mock SePay
 *   transactions API there, so no real bank or SePay account is touched).
 * Runs once on the desktop project because it creates a real order and cases.
 */
const ADMIN_URL = process.env.E2E_ADMIN_URL || "http://localhost:3002";
const WEBHOOK_KEY = process.env.SEPAY_WEBHOOK_API_KEY || "e2e-sepay-webhook-key-at-least-24-chars";
const ACCOUNT = process.env.SEPAY_BANK_ACCOUNT || "0123456789";
const MOCK_PORT = Number(process.env.E2E_SEPAY_MOCK_PORT || 4568);
const CUSTOMER = "dev-customer-token";
const ADMIN = "dev-admin-token";

test.use({ baseURL: ADMIN_URL });
test.describe.configure({ mode: "serial" });

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function sepayWebhook(body: Record<string, unknown>, key = WEBHOOK_KEY) {
  return fetch(`${API_URL}/v1/webhooks/payments/sepay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Apikey ${key}` },
    body: JSON.stringify({ transferType: "in", accountNumber: ACCOUNT, ...body }),
  });
}

interface Case { id: string; reason: string; status: string; difference: number | null; orderId: string | null; transferCode: string | null }

test.describe("AD10 Đối soát thanh toán", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop-1440", "Tạo đơn và giao dịch thật, chỉ chạy một lần ở dự án desktop");
  });

  let mock: http.Server;
  let mockTransactions: unknown[] = [];
  let orderId = "";
  let transferCode = "";
  let expected = 0;
  const stamp = Date.now();

  test.beforeAll(async () => {
    mock = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: 200, transactions: mockTransactions }));
    });
    await new Promise<void>((resolve) => mock.listen(MOCK_PORT, resolve));
  });
  test.afterAll(async () => { await new Promise((resolve) => mock.close(resolve)); });

  test("khách tạo đơn VietQR; chuyển THIẾU tiền không làm đơn thành đã thanh toán mà tạo ca đối soát", async () => {
    const product = await api<{ variants: { id: string; prices?: { currency: string }[] }[] }>("/products/klinmart", CUSTOMER);
    const variant = product.variants.find((v) => v.prices?.some((p) => p.currency === "VND")) ?? product.variants[0];
    await api("/cart", CUSTOMER, { method: "DELETE" }).catch(() => undefined);
    await api("/cart/items", CUSTOMER, { method: "POST", body: JSON.stringify({ variantId: variant.id, quantity: 1, currency: "VND" }) });
    const checkout = await api<{ order: { id: string } }>("/checkout", CUSTOMER, {
      method: "POST", body: JSON.stringify({ currency: "VND", idempotencyKey: `e2e-recon-${stamp}` }),
    });
    orderId = checkout.order.id;
    const session = await api<{ providerReference: string; amount: number }>(`/orders/${orderId}/payment-session`, CUSTOMER, {
      method: "POST", body: JSON.stringify({ provider: "sepay" }),
    });
    transferCode = session.providerReference;
    expected = session.amount;
    expect(transferCode).toMatch(/^NXS[A-F0-9]{12}$/);

    const short = expected - 90_000;
    const res = await sepayWebhook({ id: `${stamp}1`, transferAmount: short, content: `CK ${transferCode}` });
    expect(res.ok, await res.text()).toBe(true);

    const order = await api<{ status: string }>(`/orders/${orderId}`, CUSTOMER);
    expect(order.status, "đơn thiếu tiền không được tự xác nhận").toBe("PENDING_PAYMENT");

    const list = await api<{ items: Case[] }>("/admin/payments/reconciliation?status=OPEN&limit=100", ADMIN);
    const found = list.items.filter((c) => c.transferCode === transferCode);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toBe("AMOUNT_MISMATCH");
    expect(found[0].difference).toBe(-90_000);
  });

  test("gửi lại cùng webhook không tạo thêm ca; chuyển THỪA tạo ca thứ hai; sai khóa bị từ chối", async () => {
    const replay = await sepayWebhook({ id: `${stamp}1`, transferAmount: expected - 90_000, content: `CK ${transferCode}` });
    expect(replay.ok).toBe(true);
    const over = await sepayWebhook({ id: `${stamp}2`, transferAmount: expected + 10_000, content: `CK ${transferCode}` });
    expect(over.ok).toBe(true);
    const forged = await sepayWebhook({ id: `${stamp}3`, transferAmount: expected }, "sai-khoa-sepay-khong-hop-le-xxxxx");
    expect(forged.status).toBe(401);

    const list = await api<{ items: Case[] }>("/admin/payments/reconciliation?limit=100", ADMIN);
    const mine = list.items.filter((c) => c.transferCode === transferCode);
    expect(mine.map((c) => c.difference).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([-90_000, 10_000]);
    expect((await api<{ status: string }>(`/orders/${orderId}`, CUSTOMER)).status).toBe("PENDING_PAYMENT");
  });

  test("mã không khớp đơn nào và giao dịch không có mã cũng vào hàng chờ, không có đơn liên quan", async () => {
    await sepayWebhook({ id: `${stamp}4`, transferAmount: 123_000, content: "CK NXS000000000000" });
    await sepayWebhook({ id: `${stamp}5`, transferAmount: 77_000, content: "chuyen tien an trua" });
    const list = await api<{ items: Case[] }>("/admin/payments/reconciliation?status=OPEN&limit=100", ADMIN);
    const unknown = list.items.find((c) => c.transferCode === "NXS000000000000");
    expect(unknown?.reason).toBe("UNKNOWN_TRANSFER_CODE");
    expect(unknown?.orderId).toBeNull();
    expect(list.items.some((c) => c.reason === "NO_TRANSFER_CODE")).toBe(true);
  });

  test("khoản chuyển rất lớn (> 2,1 tỷ) vẫn được lưu chính xác; id giao dịch bất thường bị từ chối 400, không phải lỗi 5xx", async () => {
    const big = 3_500_000_000;
    const res = await sepayWebhook({ id: `${stamp}6`, transferAmount: big, content: "CK NXS111111111111" });
    expect(res.ok, "webhook chỉ được xác nhận khi ca đã lưu được").toBe(true);
    const list = await api<{ items: (Case & { receivedAmount: number })[] }>("/admin/payments/reconciliation?status=OPEN&limit=100", ADMIN);
    expect(list.items.find((c) => c.transferCode === "NXS111111111111")?.receivedAmount).toBe(big);

    const bad = await sepayWebhook({ id: "x".repeat(200), transferAmount: 10_000, content: "CK NXS111111111111" });
    expect(bad.status).toBe(400);
  });

  test("quyền: khách hàng không xem được; chỉ người có payment.manage mới thao tác", async () => {
    const denied = await fetch(`${API_URL}/admin/payments/reconciliation`, { headers: { Authorization: `Bearer ${CUSTOMER}` } });
    expect(denied.status).toBe(403);
    const anon = await fetch(`${API_URL}/admin/payments/reconciliation`);
    expect(anon.status).toBe(401);
    const deniedAct = await fetch(`${API_URL}/admin/payments/reconciliation/x/resolve`, {
      method: "POST", headers: { Authorization: `Bearer ${CUSTOMER}`, "Content-Type": "application/json" }, body: JSON.stringify({ resolution: "RESOLVED", note: "thử" }),
    });
    expect([401, 403]).toContain(deniedAct.status);
  });

  test("Admin UI: xem ca lệch, truy vấn lại SePay (chỉ tham khảo), ghi nhận xử lý bắt buộc có ghi chú", async ({ browser }) => {
    mockTransactions = [{ id: 9001, amount_in: expected - 90_000, code: transferCode, transaction_content: `CK ${transferCode}`, transaction_date: "2026-10-19 10:00:00" }];
    const ctx = await browser.newContext({ baseURL: ADMIN_URL, locale: "vi-VN" });
    await ctx.addInitScript(() => window.localStorage.setItem("nexus_admin_token", "dev-admin-token"));
    const page = await ctx.newPage();
    await page.goto("/admin/payments/reconciliation");
    await expect(page.getByRole("heading", { level: 1, name: "Đối soát thanh toán" })).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: transferCode }).filter({ hasText: "Thiếu" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Chi tiết" }).click();
    const panel = page.getByRole("complementary", { name: "Chi tiết giao dịch" });
    await expect(panel.getByRole("heading", { name: "Lệch số tiền" })).toBeVisible();

    await panel.getByRole("button", { name: "Truy vấn lại SePay" }).click();
    await expect(panel.getByText(/ngân hàng ghi nhận 1 giao dịch/)).toBeVisible();
    await expect(panel.getByText(/không tự xác nhận thanh toán/)).toBeVisible();
    expect((await api<{ status: string }>(`/orders/${orderId}`, CUSTOMER)).status, "truy vấn lại không được xác nhận đơn").toBe("PENDING_PAYMENT");

    await panel.getByRole("button", { name: "Lưu xử lý" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "ghi chú" })).toBeVisible();

    await panel.getByLabel("Ghi chú (bắt buộc)").fill("Đã gọi khách, hoàn 890.000 và yêu cầu chuyển lại đủ số tiền");
    await panel.getByRole("button", { name: "Lưu xử lý" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã ghi nhận xử lý" })).toBeVisible();

    const after = await api<{ items: Case[] }>("/admin/payments/reconciliation?limit=100", ADMIN);
    expect(after.items.find((c) => c.transferCode === transferCode && c.difference === -90_000)?.status).toBe("RESOLVED");
    expect((await api<{ status: string }>(`/orders/${orderId}`, CUSTOMER)).status, "xử lý ca không được tự xác nhận đơn").toBe("PENDING_PAYMENT");
    await ctx.close();
  });

  test("một ca đã xử lý không thể xử lý lại (409)", async () => {
    const list = await api<{ items: Case[] }>("/admin/payments/reconciliation?status=RESOLVED&limit=100", ADMIN);
    const done = list.items.find((c) => c.transferCode === transferCode);
    expect(done).toBeTruthy();
    const again = await fetch(`${API_URL}/admin/payments/reconciliation/${done!.id}/resolve`, {
      method: "POST", headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "DISMISSED", note: "thử xử lý lần hai" }),
    });
    expect(again.status).toBe(409);
  });
});
