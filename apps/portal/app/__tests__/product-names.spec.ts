import type { OrderDto } from "@nexus/contracts";
import { buildProductLabels, formatViDateOrNull, productLabel } from "../lib/product-names";

const orders = [{ items: [
  { productId: "p1", variantId: "v1", productName: "KlinMart", variantName: "1 website" },
  { productId: "p2", variantId: "v2", productName: "FlowPOS UI Kit", variantName: "FlowPOS UI Kit" },
] }] as unknown as OrderDto[];

describe("product labels from order snapshots", () => {
  const map = buildProductLabels(orders);
  it("resolves by variant first, then product", () => {
    expect(productLabel(map, "p1", "v1")).toEqual({ name: "KlinMart", plan: "1 website" });
    expect(productLabel(map, "p2", "v2")).toEqual({ name: "FlowPOS UI Kit", plan: null });
    expect(productLabel(map, "p1", "other").name).toBe("KlinMart");
  });
  it("never leaks raw ids when unknown", () => {
    expect(productLabel(map, "zzz-123", "yyy").name).toBe("Sản phẩm");
  });
  it("formats optional dates", () => {
    expect(formatViDateOrNull(null, "Trọn đời")).toBe("Trọn đời");
    expect(formatViDateOrNull("bad")).toBe("—");
  });
});
