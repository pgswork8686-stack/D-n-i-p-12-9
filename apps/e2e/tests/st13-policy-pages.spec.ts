import { test, expect, API_URL } from "./fixtures";

/**
 * ST13 /chinh-sach/[slug] against the real API (CMS PAGE records), on the Storefront in dev mode.
 * The storefront ships NO legal text: a policy page exists publicly only after PGS publishes a CMS PAGE.
 * This spec proves that with clearly-marked TEST content on the "hoàn tiền" slug, and it archives the page
 * at the end so nothing legal-looking stays public. If a real page already exists on that slug the test
 * skips instead of touching it.
 */
const WEB_URL = process.env.E2E_WEB_URL || "http://localhost:3000";
const ADMIN = "dev-admin-token";
const SLUG = "chinh-sach-hoan-tien";

test.use({ baseURL: WEB_URL });
test.describe.configure({ mode: "serial" });

async function admin<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${ADMIN}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const publicPage = (slug: string) => fetch(`${API_URL}/v1/content/pages/${slug}`);

test.describe("ST13 Chính sách", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop-1440", "Tạo và xuất bản nội dung CMS, chỉ chạy một lần ở dự án desktop");
  });

  let postId = "";

  // Whatever happens above, never leave the test page public.
  test.afterAll(async () => {
    if (!postId) return;
    await fetch(`${API_URL}/admin/content/posts/${postId}/transition`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ targetStatus: "ARCHIVED" }),
    }).catch(() => undefined);
  });

  test("trang chưa xuất bản thì không tồn tại công khai: 404, chỉ mục không liệt kê nó", async ({ page }) => {
    test.skip((await publicPage(SLUG)).ok, "Đã có trang chính sách thật trên slug này, không chạm vào");
    const response = await page.goto(`/chinh-sach/${SLUG}`);
    expect(response?.status()).toBe(404);

    const unknown = await page.goto("/chinh-sach/gioi-thieu");
    expect(unknown?.status(), "slug ngoài danh sách chính sách phải 404").toBe(404);

    await page.goto("/chinh-sach");
    await expect(page.getByRole("heading", { level: 1, name: "Chính sách" })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "Chính sách hoàn tiền" })).toHaveCount(0);
  });

  test("bản nháp và bài blog trùng slug không lộ ra ngoài", async () => {
    test.skip((await publicPage(SLUG)).ok, "Đã có trang chính sách thật trên slug này");
    const marker = "NỘI DUNG THỬ NGHIỆM E2E";
    const body = {
      title: `Chính sách hoàn tiền (${marker})`,
      excerpt: "Nội dung thử nghiệm, không phải chính sách thật.",
      content: "<h2>Thử nghiệm</h2><p>Đây là nội dung thử nghiệm tự động, chưa được PGS phê duyệt.</p><script>alert(1)</script>",
    };
    // Reuse our own archived test page from an earlier run (slugs are unique); never touch anyone else's.
    const existing = await admin<{ items: { id: string; slug: string; title: string; status: string }[] }>(`/admin/content/posts?limit=100&search=${SLUG}`);
    const mine = existing.items.find((p) => p.slug === SLUG);
    if (mine && !mine.title.includes(marker)) test.skip(true, "Slug đã dùng cho nội dung thật, không chạm vào");
    if (mine) {
      postId = mine.id;
      await admin(`/admin/content/posts/${postId}`, { method: "PATCH", body: JSON.stringify(body) });
      if (mine.status !== "DRAFT") {
        await admin(`/admin/content/posts/${postId}/transition`, { method: "POST", body: JSON.stringify({ targetStatus: "DRAFT" }) });
      }
    } else {
      const created = await admin<{ id: string }>("/admin/content/posts", {
        method: "POST",
        body: JSON.stringify({ ...body, slug: SLUG, contentType: "PAGE" }),
      });
      postId = created.id;
    }
    expect((await publicPage(SLUG)).status, "bản nháp không được công khai").toBe(404);
    // The blog endpoint serves ARTICLE only, so a PAGE can never leak through it either.
    expect((await fetch(`${API_URL}/v1/content/posts/${SLUG}`)).status).toBe(404);
  });

  test("sau khi PGS duyệt và xuất bản: trang hiển thị, nội dung được làm sạch, chỉ mục có link", async ({ page }) => {
    test.skip(!postId, "Không có bản nháp thử nghiệm");
    await admin(`/admin/content/posts/${postId}/transition`, { method: "POST", body: JSON.stringify({ targetStatus: "REVIEW" }) });
    await admin(`/admin/content/posts/${postId}/transition`, { method: "POST", body: JSON.stringify({ targetStatus: "PUBLISHED" }) });

    const response = await page.goto(`/chinh-sach/${SLUG}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: /Chính sách hoàn tiền/ })).toBeVisible();
    await expect(page.getByText("Đây là nội dung thử nghiệm tự động")).toBeVisible();
    expect(await page.content(), "script trong nội dung phải bị loại bỏ").not.toContain("alert(1)");

    await page.goto("/chinh-sach");
    // The footer link is cached for up to 5 minutes by design, so it is covered by unit tests, not asserted here.
    await page.locator("#main").getByRole("link", { name: /Chính sách hoàn tiền/ }).click();
    await expect(page).toHaveURL(new RegExp(`/chinh-sach/${SLUG}$`));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "không tràn ngang").toBeLessThanOrEqual(1);
  });

  test("dọn dẹp: lưu trữ trang thử nghiệm thì công khai lại là 404", async ({ page }) => {
    test.skip(!postId, "Không có bản nháp thử nghiệm");
    await admin(`/admin/content/posts/${postId}/transition`, { method: "POST", body: JSON.stringify({ targetStatus: "ARCHIVED" }) });
    expect((await publicPage(SLUG)).status).toBe(404);
    const response = await page.goto(`/chinh-sach/${SLUG}`);
    expect(response?.status()).toBe(404);
  });
});
