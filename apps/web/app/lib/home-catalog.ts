import type { CategoryDto, PublicProductListItemDto } from "@nexus/contracts";
import { DEFAULT_CURRENCY } from "./format";

export interface NavCategory {
  name: string;
  slug: string;
}

/**
 * Root categories in the order set by admins (AD06). `GET /categories`
 * returns a tree of active roots with `children`; nav shows the roots only.
 */
export function navCategories(tree: CategoryDto[], max = 8): NavCategory[] {
  return tree
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .slice(0, max)
    .map(({ name, slug }) => ({ name, slug }));
}

export function flattenCategories(tree: CategoryDto[]): CategoryDto[] {
  const out: CategoryDto[] = [];
  const walk = (nodes: CategoryDto[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * Homepage topic rows (ST01 R5, R6, R6b). Each topic is shown only when a
 * category with one of these slugs exists in the catalog — slugs are managed
 * in Admin → Danh mục. Order inside `slugs` is preference order.
 */
export const HOME_TOPICS = {
  wordpress: { slugs: ["theme-wordpress", "wordpress"] },
  plugins: { slugs: ["plugins", "plugin"] },
  uiKits: { slugs: ["ui-kits-figma", "ui-kits", "design"] },
  webApp: { slugs: ["web-app"] },
  mobileApp: { slugs: ["mobile-app"] },
  chatbot: { slugs: ["chatbot-ai"] },
} as const;

export type HomeTopicKey = keyof typeof HOME_TOPICS;

export function findTopicCategory(flat: CategoryDto[], key: HomeTopicKey): CategoryDto | undefined {
  for (const slug of HOME_TOPICS[key].slugs) {
    const hit = flat.find((c) => c.slug === slug);
    if (hit) return hit;
  }
  return undefined;
}

/** Lowest price in the storefront currency, else the API's overall minimum. */
export function pickPrice(product: PublicProductListItemDto): { amount: number; currency: string } | null {
  const inDefault =
    product.minPricesByCurrency?.[DEFAULT_CURRENCY] ??
    (product.minPrice?.currency === DEFAULT_CURRENCY ? product.minPrice.amount : undefined);
  if (inDefault !== undefined) return { amount: inDefault, currency: DEFAULT_CURRENCY };
  return product.minPrice ? { amount: product.minPrice.amount, currency: product.minPrice.currency } : null;
}

// ── Consultation form (ST01 R8) ───────────────────────────────────────────

export interface ConsultInput {
  name: string;
  email: string;
  phone: string;
  websiteType: string;
  message: string;
  consent: boolean;
}

export type ConsultErrors = Partial<Record<keyof ConsultInput, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Vietnamese mobile/landline: optional +84 or 0, then 9–10 digits.
const PHONE = /^(\+84|0)\d{9,10}$/;

export function validateConsult(input: ConsultInput): ConsultErrors {
  const errors: ConsultErrors = {};
  if (!input.name.trim()) errors.name = "Vui lòng nhập họ và tên";
  if (!input.email.trim()) errors.email = "Vui lòng nhập email";
  else if (!EMAIL.test(input.email.trim())) errors.email = "Email chưa đúng định dạng";
  const phone = input.phone.replace(/[\s.-]/g, "");
  if (phone && !PHONE.test(phone)) errors.phone = "Số điện thoại chưa đúng định dạng";
  if (!input.consent) errors.consent = "Vui lòng đồng ý để chúng tôi liên hệ tư vấn";
  return errors;
}
