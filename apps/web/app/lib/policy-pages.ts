/**
 * ST13 policy pages. The copy lives in the CMS as PAGE records and must be approved by PGS before it is
 * published; the storefront never contains or invents legal text. Only these slugs are routable, and a
 * page that is not PUBLISHED simply does not exist publicly (404, and no footer link).
 */
export interface PolicyPage {
  slug: string;
  title: string;
}

export const POLICY_PAGES: readonly PolicyPage[] = [
  { slug: "chinh-sach-quyen-rieng-tu", title: "Chính sách quyền riêng tư" },
  { slug: "dieu-khoan-su-dung", title: "Điều khoản sử dụng" },
  { slug: "chinh-sach-thanh-toan", title: "Chính sách thanh toán" },
  { slug: "chinh-sach-giao-nhan-san-pham-so", title: "Chính sách giao nhận sản phẩm số" },
  { slug: "chinh-sach-doi-tra", title: "Chính sách đổi trả" },
  { slug: "chinh-sach-hoan-tien", title: "Chính sách hoàn tiền" },
];

export function findPolicyPage(slug: string): PolicyPage | null {
  return POLICY_PAGES.find((page) => page.slug === slug) ?? null;
}

export function policyHref(slug: string): string {
  return `/chinh-sach/${slug}`;
}
