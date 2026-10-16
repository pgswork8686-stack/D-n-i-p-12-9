import AxeBuilder from "@axe-core/playwright";
import { test, expect, apiGet, scrollThrough } from "./fixtures";

type Product = { slug: string; name: string; categories: { slug: string; name: string }[] };
type Category = { slug: string; name: string; parentId?: string | null; sortOrder: number };

// Section headings in the order of the Figma ST01 frame. Topic rows are only
// rendered when the catalog has a matching category, so the seeded demo data
// (apps/e2e/fixtures) must be present.
/** Which ST01 consultation block the stack under test serves: `cta` (production default) or `demo` (FEATURE_CONSULT_FORM_DEMO=true). */
const CONSULT_MODE = process.env.E2E_CONSULT_MODE === "demo" ? "demo" : "cta";

const SECTION_ORDER = [
  "hero-heading",
  "latest-heading",
  "wp-heading",
  "tools-heading",
  "solutions-heading",
  "steps-heading",
  "consult-heading",
  "news-heading",
];

test.describe("ST01 · Trang chủ", () => {
  test("has a single h1 and every section in the Figma order", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("Khởi tạo website chuyên nghiệp");
    const tops = await page.evaluate((ids) => ids.map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? null), SECTION_ORDER);
    expect(tops.every((t) => t !== null), `missing sections: ${SECTION_ORDER.filter((_, i) => tops[i] === null).join(", ")}`).toBe(true);
    expect([...tops].sort((a, b) => a! - b!)).toEqual(tops);
  });

  test("does not scroll horizontally", async ({ page }) => {
    await page.goto("/");
    await scrollThrough(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("has no console errors and no broken images", async ({ page, consoleErrors }) => {
    await page.goto("/");
    await scrollThrough(page);
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
    expect(broken).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("hero search sends the query to the catalog API and lists the match", async ({ page }) => {
    const { items } = await apiGet<{ items: Product[] }>("/products?limit=1&sort=newest&currency=VND");
    test.skip(items.length === 0, "catalog is empty");
    const term = items[0].name.split(/\s+/)[0];
    await page.goto("/");
    await page.fill("#hero-search", term);
    await page.click("form[role=search] button[type=submit]");
    await expect(page).toHaveURL(new RegExp(`/products\\?search=${encodeURIComponent(term)}`));
    await expect(page.getByRole("link", { name: new RegExp(items[0].name) }).first()).toBeVisible();
  });

  test("hero category filter narrows the catalog to that category", async ({ page }) => {
    const tree = await apiGet<Category[]>("/categories");
    const root = tree.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    test.skip(!root, "no categories");
    const { items } = await apiGet<{ items: Product[] }>(`/products?category=${root.slug}&limit=1&currency=VND`);
    await page.goto("/");
    await page.selectOption("#hero-category", root.slug);
    await page.click("form[role=search] button[type=submit]");
    await expect(page).toHaveURL(new RegExp(`category=${root.slug}`));
    if (items[0]) await expect(page.getByRole("link", { name: new RegExp(items[0].name) }).first()).toBeVisible();
  });

  test("category tabs come from the API, in admin order, and open the filtered list", async ({ page }) => {
    const tree = await apiGet<Category[]>("/categories");
    const roots = tree.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 8);
    await page.goto("/");
    const tabs = page.locator("nav[aria-label='Danh mục sản phẩm'] a");
    await expect(tabs).toHaveCount(roots.length + 1);
    expect(await tabs.allInnerTexts()).toEqual(["Tất cả", ...roots.map((c) => c.name)]);
    await tabs.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/products\\?category=${roots[0].slug}`));
  });

  test("a product card opens its product detail page", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("section[aria-labelledby=latest-heading] a[href^='/products/']").first();
    const href = await card.getAttribute("href");
    const name = (await card.locator("h3").innerText()).trim();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator("h1")).toContainText(name);
  });

  test("product cards show image, name, price and CTA at every width", async ({ page }) => {
    await page.goto("/");
    await scrollThrough(page);
    const cards = page.locator("section[aria-labelledby=latest-heading] a[href^='/products/']");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 4); i++) {
      const card = cards.nth(i);
      const box = (await card.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(150);
      await expect(card.locator("img").first()).toBeVisible();
      await expect(card.locator("h3")).toBeVisible();
      await expect(card.getByText(/₫|Liên hệ/).first()).toBeVisible();
      const cta = card.getByText("Xem chi tiết");
      await expect(cta).toBeVisible();
      const ctaBox = (await cta.boundingBox())!;
      expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  });

  test("header 'Sản phẩm' menu lists every category group and closes with Escape", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1440", "the inline nav exists from 1024px; covered at 1440");
    const tree = await apiGet<Category[]>("/categories");
    const roots = tree.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 8);
    await page.goto("/");
    const button = page.getByRole("button", { name: "Sản phẩm" });
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator("#products-menu");
    for (const c of roots) await expect(menu.getByRole("link", { name: c.name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("header nav is never clipped and the page never overflows, 1024–1920px", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1440", "sweeps desktop widths itself");
    for (const width of [1024, 1280, 1366, 1440, 1536, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
      const fit = await nav.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fit.scroll, `${width}px: nav content wider than its box → links clipped`).toBeLessThanOrEqual(fit.client);
      await expect(nav.getByRole("link", { name: "Blog", exact: true }), `${width}px: Blog link`).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px: horizontal page overflow`).toBeLessThanOrEqual(0);
    }
  });

  test("production mode: no simulated form, the consultation CTA goes to a real channel", async ({ page }) => {
    test.skip(CONSULT_MODE !== "cta", "stack runs with FEATURE_CONSULT_FORM_DEMO=true (E2E_CONSULT_MODE=demo)");
    await page.goto("/");
    const section = page.locator("section[aria-labelledby=consult-heading]");
    await expect(section.locator("form")).toHaveCount(0);
    await expect(section.getByText("Mô phỏng")).toHaveCount(0);
    const cta = section.getByRole("link", { name: /Gửi yêu cầu tư vấn/ });
    await expect(cta).toHaveAttribute("href", /\/tickets$/);
  });

  test("consultation form validates and never sends a request", async ({ page }) => {
    test.skip(CONSULT_MODE !== "demo", "simulated form is off (FEATURE_CONSULT_FORM_DEMO not true) — production configuration");
    const writes: string[] = [];
    page.on("request", (r) => r.method() !== "GET" && !r.url().includes("/_next/") && writes.push(`${r.method()} ${r.url()}`));
    await page.goto("/");
    await expect(page.getByText("Mô phỏng — kênh nhận yêu cầu tư vấn chưa hoạt động")).toBeVisible();
    await page.getByRole("button", { name: "Gửi yêu cầu tư vấn" }).click();
    await expect(page.locator(".field-error")).toHaveCount(3);
    await expect(page.locator("#consult-name")).toHaveAttribute("aria-invalid", "true");
    // the error summary takes focus so keyboard and screen-reader users land on it
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("alert");
    await page.fill("#consult-name", "Khách Demo");
    await page.fill("#consult-email", "khach@demo.vn");
    await page.fill("#consult-phone", "12345");
    await page.check("#consult-consent");
    await page.getByRole("button", { name: "Gửi yêu cầu tư vấn" }).click();
    // shown next to the field and linked from the error summary
    await expect(page.locator("#consult-phone-error")).toHaveText("Số điện thoại chưa đúng định dạng");
    await expect(page.getByRole("link", { name: "Số điện thoại chưa đúng định dạng" })).toHaveAttribute("href", "#consult-phone");
    await page.fill("#consult-phone", "0901 234 567");
    await page.getByRole("button", { name: "Gửi yêu cầu tư vấn" }).click();
    await expect(page.getByText("Mô phỏng — yêu cầu chưa được gửi")).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("keyboard: skip link comes first and moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Bỏ qua tới nội dung");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    const tab = page.locator("nav[aria-label='Danh mục sản phẩm'] a").nth(1);
    await tab.focus();
    const outline = await tab.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("has no serious or critical accessibility violations (axe)", async ({ page }) => {
    await page.goto("/");
    await scrollThrough(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes[0]?.target.join(" ")}`);
    expect(serious).toEqual([]);
  });
});
