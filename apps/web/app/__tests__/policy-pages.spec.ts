import { POLICY_PAGES, findPolicyPage, policyHref } from "../lib/policy-pages";
import { fetchPageBySlug, fetchPublishedPolicySlugs } from "../lib/storefront-fetch";

describe("ST13 policy pages", () => {
  it("routes exactly the six policy slugs", () => {
    expect(POLICY_PAGES.map((p) => p.slug)).toEqual([
      "chinh-sach-quyen-rieng-tu",
      "dieu-khoan-su-dung",
      "chinh-sach-thanh-toan",
      "chinh-sach-giao-nhan-san-pham-so",
      "chinh-sach-doi-tra",
      "chinh-sach-hoan-tien",
    ]);
    expect(findPolicyPage("dieu-khoan-su-dung")?.title).toBe("Điều khoản sử dụng");
    expect(findPolicyPage("../etc/passwd")).toBeNull();
    expect(findPolicyPage("gioi-thieu")).toBeNull();
    expect(policyHref("chinh-sach-doi-tra")).toBe("/chinh-sach/chinh-sach-doi-tra");
  });

  it("reads a page from /v1/content/pages and maps 404 to null", async () => {
    const ok = jest.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ title: "T" }) });
    await expect(fetchPageBySlug("dieu-khoan-su-dung", ok as unknown as typeof fetch)).resolves.toEqual({ title: "T" });
    expect(String(ok.mock.calls[0][0])).toContain("/v1/content/pages/dieu-khoan-su-dung");

    const missing = jest.fn().mockResolvedValue({ status: 404, ok: false });
    await expect(fetchPageBySlug("x", missing as unknown as typeof fetch)).resolves.toBeNull();

    const broken = jest.fn().mockResolvedValue({ status: 500, ok: false });
    await expect(fetchPageBySlug("x", broken as unknown as typeof fetch)).rejects.toThrow();
  });

  it("lists only published pages for the footer and never throws", async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes("chinh-sach-doi-tra")) return { ok: true } as Response;
      if (url.includes("chinh-sach-hoan-tien")) throw new Error("network down");
      return { ok: false, status: 404 } as Response;
    });
    const slugs = await fetchPublishedPolicySlugs(POLICY_PAGES.map((p) => p.slug), fetchFn as unknown as typeof fetch);
    expect(slugs).toEqual(["chinh-sach-doi-tra"]);
  });
});
