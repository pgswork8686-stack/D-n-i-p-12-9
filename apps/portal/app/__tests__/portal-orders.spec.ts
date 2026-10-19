import type { OrderDto } from "@nexus/contracts";
import {
  filterOrders, formatViDate, itemEntitlementSummary, monthsLabel, orderProductSummary,
  paginate, paymentProviderLabel, succeededPayment,
} from "../lib/portal-orders";

const order = (n: string, status: OrderDto["status"], items: { productName: string; variantName: string }[]): OrderDto =>
  ({ id: n, orderNumber: n, status, items } as unknown as OrderDto);

describe("PT08 order list helpers", () => {
  const orders = [
    order("NXS-2026-00131", "PENDING_PAYMENT", [{ productName: "NexBot", variantName: "NexBot" }]),
    order("NXS-2026-00128", "PAID", [{ productName: "KlinMart", variantName: "1 website" }, { productName: "FlowPOS UI Kit", variantName: "FlowPOS UI Kit" }]),
  ];
  it("filters by status and by order number, case-insensitively", () => {
    expect(filterOrders(orders, "", "").length).toBe(2);
    expect(filterOrders(orders, "PAID", "").map(o => o.orderNumber)).toEqual(["NXS-2026-00128"]);
    expect(filterOrders(orders, "", "nxs-2026-00131").map(o => o.orderNumber)).toEqual(["NXS-2026-00131"]);
    expect(filterOrders(orders, "PAID", "00131")).toEqual([]);
  });
  it("summarises products from the order snapshot, including plan names", () => {
    expect(orderProductSummary(orders[1])).toBe("KlinMart (1 website), FlowPOS UI Kit");
    expect(orderProductSummary(orders[0])).toBe("NexBot");
    expect(orderProductSummary(order("x", "PAID", []))).toBe("—");
  });
  it("formats dates in vi-VN and tolerates bad input", () => {
    expect(formatViDate("2026-10-12T03:31:00Z")).toMatch(/12\/10\/2026|12\/10\/2026/);
    expect(formatViDate("not a date")).toBe("—");
    expect(formatViDate(null)).toBe("—");
  });
});

describe("PT09 order detail helpers", () => {
  it("names payment providers for customers and passes unknown ones through", () => {
    expect(paymentProviderLabel("sepay")).toBe("Chuyển khoản VietQR");
    expect(paymentProviderLabel("stripe")).toBe("Thẻ quốc tế (Stripe)");
    expect(paymentProviderLabel("momo")).toBe("momo");
    expect(paymentProviderLabel(null)).toBe("—");
  });
  it("only treats a SUCCEEDED payment as proof of payment", () => {
    const base = { id: "o", orderNumber: "o", status: "PENDING_PAYMENT", items: [] } as unknown as OrderDto;
    expect(succeededPayment({ ...base, payments: [{ status: "PENDING" }, { status: "FAILED" }] } as unknown as OrderDto)).toBeNull();
    expect(succeededPayment({ ...base, payments: [{ status: "PENDING" }, { id: "p2", status: "SUCCEEDED" }] } as unknown as OrderDto)?.id).toBe("p2");
    expect(succeededPayment(base)).toBeNull();
  });
  it("describes entitlement terms only from snapshot fields that exist", () => {
    expect(monthsLabel(360)).toBe("12 tháng");
    expect(monthsLabel(15)).toBe("1 tháng");
    expect(monthsLabel(0)).toBeNull();
    expect(monthsLabel(null)).toBeNull();
    const item = (o: object) => ({ productName: "KlinMart", variantName: "1 website", ...o }) as OrderDto["items"][number];
    expect(itemEntitlementSummary(item({ updatesDays: 360, supportDays: 180 }))).toBe("Gói 1 website · cập nhật 12 tháng · hỗ trợ 6 tháng");
    expect(itemEntitlementSummary(item({ isLifetime: true }))).toBe("Gói 1 website · trọn đời");
    expect(itemEntitlementSummary({ productName: "A", variantName: "A" } as OrderDto["items"][number])).toBe("—");
  });
});
describe("PT08 paging", () => {
  const list = Array.from({ length: 45 }, (_, i) => i);
  it("slices 20 per page and clamps out-of-range pages", () => {
    expect(paginate(list, 1).items.length).toBe(20);
    expect(paginate(list, 3).items).toEqual([40, 41, 42, 43, 44]);
    expect(paginate(list, 99).page).toBe(3);
    expect(paginate(list, -5).page).toBe(1);
    expect(paginate([], 1)).toMatchObject({ items: [], page: 1, totalPages: 1, total: 0 });
  });
});