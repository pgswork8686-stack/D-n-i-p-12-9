import { test, expect, API_URL } from "./fixtures";

/**
 * Admin screens AD05, AD11–AD16 against the real API, database and object storage.
 * Signs in with the development bearer tokens the API accepts outside production
 * (the Admin app must be built/run with NEXT_PUBLIC_DEV_AUTH_ENABLED=true).
 * Stateful tests only run on the desktop project so a three-viewport run creates data once.
 */
const ADMIN_URL = process.env.E2E_ADMIN_URL || "http://localhost:3002";
const ADMIN_TOKEN = "dev-admin-token";
const CUSTOMER_TOKEN = "dev-customer-token";

test.use({ baseURL: ADMIN_URL });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => window.localStorage.setItem("nexus_admin_token", token), ADMIN_TOKEN);
});

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const desktopOnly = (name: string) => name === "desktop-1440";

test.describe("AD14 Khách hàng", () => {
  test("lists real users, filters by role and keeps role assignment locked", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Khách hàng", level: 1 })).toBeVisible();
    await expect(page.getByText("admin@nexustheme.dev").first()).toBeVisible();
    await expect(page.getByText("Gán vai trò đang khóa")).toBeVisible();
    await page.getByLabel("Tìm theo tên hoặc email").fill("customer@nexustheme.dev");
    await expect(page.getByText("customer@nexustheme.dev").first()).toBeVisible();
    await expect(page.getByText("admin@nexustheme.dev")).toHaveCount(0);
  });
});

test.describe("AD11 Quyền sử dụng", () => {
  test("lists entitlements and requires a reason before revoking", async ({ page }) => {
    await page.goto("/admin/entitlements");
    await expect(page.getByRole("heading", { name: /Quyền sử dụng/, level: 1 })).toBeVisible();
    await page.getByLabel("Trạng thái").selectOption("ACTIVE");
    await expect(page.getByRole("status").filter({ hasText: /Có \d+ quyền sử dụng/ })).toBeVisible();
    const revoke = page.getByRole("button", { name: "Thu hồi" }).first();
    test.skip((await revoke.count()) === 0, "Không có quyền sử dụng đang hoạt động trong dữ liệu thử");
    await revoke.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForLoadState("networkidle");
    await dialog.getByRole("button", { name: "Thu hồi" }).scrollIntoViewIfNeeded();
    await dialog.getByRole("button", { name: "Thu hồi" }).dispatchEvent("click");
    await expect(page.locator("main [role=alert]")).toContainText("lý do");
    await dialog.getByRole("button", { name: "Hủy" }).dispatchEvent("click");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("AD12 License nội bộ", () => {
  test("shows masked keys only and a detail panel", async ({ page }) => {
    await page.goto("/admin/internal-licenses");
    await expect(page.getByRole("heading", { name: "License nội bộ", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Có \d+ license/ })).toBeVisible();
    const keys = page.getByRole("button", { name: /^NXS-\*{4}-\*{4}-/ });
    test.skip((await keys.count()) === 0, "Không có license nội bộ trong dữ liệu thử");
    await keys.nth(0).click();
    await expect(page.getByRole("complementary", { name: "Chi tiết license" })).toBeVisible();
    await expect(page.getByLabel("Lý do thu hồi")).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}/);
  });
});

test.describe("AD13 License quản lý hộ", () => {
  test("renders the provider capacity and the pending queue", async ({ page }) => {
    await page.goto("/admin/license-allocations");
    await expect(page.getByRole("heading", { name: "License quản lý hộ", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Chờ xử lý/ })).toBeVisible();
    await expect(page.getByText("Quy trình", { exact: true })).toBeVisible();
  });
});

test.describe("AD15–AD16 Ticket Admin", () => {
  test("staff replies publicly, writes an internal note the customer never sees, then closes", async ({ page }, info) => {
    test.skip(!desktopOnly(info.project.name), "Ticket được tạo một lần ở dự án desktop");
    const subject = `E2E AD15 ${Date.now()}`;
    const created = await api<{ id: string; ticketNumber: string }>("/tickets", CUSTOMER_TOKEN, {
      method: "POST",
      body: JSON.stringify({ subject, body: "Nội dung ticket thử nghiệm E2E", category: "GENERAL" }),
    });

    await page.goto("/admin/tickets");
    await page.getByRole("button", { name: "Tất cả", exact: true }).click();
    await page.getByRole("link", { name: created.ticketNumber }).click();
    await expect(page.getByRole("heading", { name: subject, level: 1 })).toBeVisible();
    await expect(page.getByText("Nội dung ticket thử nghiệm E2E")).toBeVisible();

    await page.getByRole("textbox", { name: "Trả lời khách" }).fill("Chào bạn, chúng tôi đã nhận được yêu cầu.");
    await page.getByRole("button", { name: "Gửi phản hồi" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã gửi phản hồi" })).toBeVisible();
    await expect(page.getByText("Chào bạn, chúng tôi đã nhận được yêu cầu.")).toBeVisible();

    await page.getByRole("textbox", { name: "Trả lời khách" }).fill("Ghi chú nội bộ: kiểm tra giấy phép.");
    await page.getByLabel("Ghi chú nội bộ (khách không thấy)").check();
    await page.getByRole("button", { name: "Lưu ghi chú" }).click();
    await expect(page.getByText("Chỉ nhân viên nhìn thấy")).toBeVisible();

    const customerView = await api<{ messages?: { body: string; isInternalNote: boolean }[] }>(`/tickets/${created.id}`, CUSTOMER_TOKEN);
    const bodies = (customerView.messages ?? []).map((m) => m.body);
    expect(bodies.some((b) => b.includes("đã nhận được yêu cầu"))).toBe(true);
    expect(bodies.some((b) => b.includes("Ghi chú nội bộ"))).toBe(false);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Đóng ticket" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã đóng ticket" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Trả lời khách" })).toBeDisabled();
  });
});

test.describe("AD05 Phiên bản & file", () => {
  test("creates a draft, uploads a .zip to object storage and publishes it", async ({ page }, info) => {
    test.skip(!desktopOnly(info.project.name), "Phiên bản được tạo một lần ở dự án desktop");
    const products = await api<{ items: { id: string }[] }>("/admin/products?limit=1", ADMIN_TOKEN);
    test.skip(products.items.length === 0, "Không có sản phẩm trong dữ liệu thử");
    const version = `9.${Date.now() % 100000}.0`;

    await page.goto(`/admin/products/${products.items[0].id}/versions`);
    await expect(page.getByRole("heading", { name: /Phiên bản/, level: 1 })).toBeVisible();

    await page.getByLabel("Số phiên bản").fill("v1");
    await page.getByRole("button", { name: "Tạo phiên bản" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("1.2.3");

    await page.getByLabel("Số phiên bản").fill(version);
    await page.getByRole("button", { name: "Tạo phiên bản" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã tạo phiên bản nháp" })).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(`Phiên bản ${version.replace(/\./g, "\\.")}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: "Phát hành", exact: true })).toBeDisabled();

    const zip = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
    await page.getByLabel("Kéo thả hoặc chọn tệp .zip").setInputFiles({ name: "e2e-package.zip", mimeType: "application/zip", buffer: zip });
    await page.getByRole("button", { name: "Tải lên", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã tải lên" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "e2e-package.zip" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Phát hành", exact: true })).toBeEnabled();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Phát hành", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Đã phát hành phiên bản" })).toBeVisible();
    await expect(page.getByText("Phiên bản đã phát hành và không thể sửa.")).toBeVisible();
  });
});

test.describe("Admin responsive layout (Figma: bảng → thẻ dưới 768px)", () => {
  for (const path of ["/admin/tickets", "/admin/entitlements", "/admin/internal-licenses", "/admin/users", "/admin/license-allocations"]) {
    test(`${path} never scrolls horizontally`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test("tables become labelled cards on a phone", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-390", "Chỉ kiểm ở viewport điện thoại");
    await page.goto("/admin/entitlements");
    const cell = page.locator("main table tbody td").first();
    await expect(cell).toBeVisible();
    expect(await cell.evaluate((el) => getComputedStyle(el).display)).toBe("block");
    expect(await cell.getAttribute("data-label")).toBeTruthy();
    expect(await page.locator("main table thead").evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  });
});