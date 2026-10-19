import { test, expect, API_URL } from "./fixtures";

/**
 * Admin screens AD01, AD03, AD04, AD07, AD17–AD20 (the older pages) against the real API:
 * Vietnamese titles and copy, no horizontal overflow at 1440/768/390, and a real product
 * create → price flow. Dev bearer tokens as in admin-ad05-ad16.spec.ts.
 */
const ADMIN_URL = process.env.E2E_ADMIN_URL || "http://localhost:3002";
const ADMIN_TOKEN = "dev-admin-token";

test.use({ baseURL: ADMIN_URL });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => window.localStorage.setItem("nexus_admin_token", token), ADMIN_TOKEN);
});

const PAGES: { path: string; heading: RegExp }[] = [
  { path: "/admin/products", heading: /^Quản lý sản phẩm$/ },
  { path: "/admin/products/new", heading: /^Thêm sản phẩm$/ },
  { path: "/content", heading: /^Nội dung & xuất bản$/ },
  { path: "/content/new", heading: /^Tạo bài viết mới$/ },
  { path: "/content/categories", heading: /^Danh mục nội dung$/ },
  { path: "/automation", heading: /^Tự động hóa & AI$/ },
];

test.describe("Admin cũ: tiếng Việt và không tràn ngang", () => {
  for (const { path, heading } of PAGES) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} tràn ngang ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test("AD01 đăng nhập hiển thị tiếng Việt", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: ADMIN_URL });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Quản trị NexusTheme");
    await expect(page.getByRole("button", { name: /Đăng nhập/ }).first()).toBeVisible();
    await ctx.close();
  });
});

test.describe("AD03–AD07 Sản phẩm & giá", () => {
  test("tạo sản phẩm → thêm gói bán → thêm giá → đăng bán", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1440", "Dữ liệu chỉ được tạo một lần ở dự án desktop");
    const stamp = Date.now();
    await page.goto("/admin/products/new");
    await expect(page.getByRole("button", { name: "Tạo sản phẩm" })).toBeEnabled();
    await page.getByLabel("Tên sản phẩm *").fill(`E2E Sản phẩm ${stamp}`);
    await page.getByLabel("Đường dẫn (slug) *").fill(`e2e-san-pham-${stamp}`);
    await page.getByRole("button", { name: "Tạo sản phẩm" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1, name: `E2E Sản phẩm ${stamp}` })).toBeVisible();

    await page.getByPlaceholder("vd: 5 website hoặc Không giới hạn").fill("1 website");
    await page.getByPlaceholder("vd: PROD-5SITES").fill(`E2E-${stamp}`);
    await page.getByRole("button", { name: "Thêm gói" }).click();
    await expect(page.getByText("Đã tạo gói bán")).toBeVisible();

    await page.getByRole("button", { name: "+ Thêm giá" }).first().click();
    await page.getByPlaceholder("Số tiền").fill("490000");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByText("Đã thêm giá")).toBeVisible();
    await expect(page.getByText(/490\.000 VND/)).toBeVisible();

    await page.getByRole("button", { name: "Đăng bán" }).click();
    await expect(page.getByText(/Đã đổi trạng thái sản phẩm thành “Đang bán”/)).toBeVisible();
    void API_URL;
  });
});
