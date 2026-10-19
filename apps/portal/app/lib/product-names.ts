import type { OrderDto } from "@nexus/contracts";

export interface ProductLabel { name: string; plan: string | null }

/** Maps variantId (then productId) → names snapshotted on the customer's own orders. */
export function buildProductLabels(orders: OrderDto[]): Map<string, ProductLabel> {
  const map = new Map<string, ProductLabel>();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      const plan = item.variantName && item.variantName !== item.productName ? item.variantName : null;
      const label = { name: item.productName, plan };
      if (item.variantId && !map.has(item.variantId)) map.set(item.variantId, label);
      if (item.productId && !map.has(item.productId)) map.set(item.productId, { name: item.productName, plan: null });
    }
  }
  return map;
}

/** Never shows a raw id as if it were a name: falls back to a neutral label. */
export function productLabel(map: Map<string, ProductLabel>, productId: string, variantId?: string | null): ProductLabel {
  return (variantId && map.get(variantId)) || map.get(productId) || { name: "Sản phẩm", plan: null };
}

export function formatViDateOrNull(value?: string | null, fallback = "—"): string {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString("vi-VN");
}
