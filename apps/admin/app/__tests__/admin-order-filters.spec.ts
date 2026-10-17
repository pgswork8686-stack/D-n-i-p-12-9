import {
  ADMIN_ORDER_PAGE_SIZE, adminOrderQuery, adminOrderStatusLabel,
  parseAdminOrderPage,
} from "../lib/admin-order-filters";

describe("B5 AD08 Admin orders filters and pagination", () => {
  it("paginates with a bounded page size and a validated page number", () => {
    expect(adminOrderQuery(3, "")).toBe("page=3&limit=" + ADMIN_ORDER_PAGE_SIZE);
    expect(adminOrderQuery(-3, "")).toBe("page=1&limit=" + ADMIN_ORDER_PAGE_SIZE);
    expect(adminOrderQuery(Number.POSITIVE_INFINITY, "")).toBe("page=1&limit=" + ADMIN_ORDER_PAGE_SIZE);
  });
  it("passes only recognized server status filters", () => {
    expect(adminOrderQuery(1, "PAID")).toContain("status=PAID");
    expect(adminOrderQuery(1, "PENDING_PAYMENT")).toContain("status=PENDING_PAYMENT");
    expect(adminOrderQuery(1, "CANCELLED")).toContain("status=CANCELLED");
    expect(adminOrderQuery(1, "MANUALLY_SETTLED" as any)).not.toContain("status=");
  });
  it("does not fabricate a total count if the API response is malformed", () => {
    expect(() => parseAdminOrderPage({ items: [], total: undefined, page: 1, limit: 20, totalPages: 1 })).toThrow();
    expect(() => parseAdminOrderPage({ items: [], total: -1, page: 1, limit: 20, totalPages: 1 })).toThrow();
    expect(() => parseAdminOrderPage({ items: null, total: 0, page: 1, limit: 20, totalPages: 1 })).toThrow();
  });
  it("preserves the server authoritative totals", () => {
    const result = parseAdminOrderPage({ items: [], total: 43, page: 2, limit: 20, totalPages: 3 });
    expect(result.total).toBe(43);
    expect(result.totalPages).toBe(3);
  });
  it("provides Vietnamese payment labels", () => {
    expect(adminOrderStatusLabel("PENDING_PAYMENT")).toBe("Chờ thanh toán");
  });
});
