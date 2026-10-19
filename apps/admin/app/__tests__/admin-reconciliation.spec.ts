import {
  differenceLabel, parseReconciliationPage, reasonLabel, reconciliationQuery, statusLabel, validateResolutionNote,
} from "../lib/admin-reconciliation";
import { visibleAdminNavigation } from "../lib/admin-navigation";

describe("AD10 reconciliation helpers", () => {
  it("builds a safe query and ignores unknown filters", () => {
    expect(reconciliationQuery(2, "OPEN", "AMOUNT_MISMATCH")).toBe("page=2&limit=20&status=OPEN&reason=AMOUNT_MISMATCH");
    expect(reconciliationQuery(-1, "HACK" as never, "X" as never)).toBe("page=1&limit=20");
  });

  it("labels under/over payment and unknown orders", () => {
    expect(differenceLabel(-90000)).toMatch(/^Thiếu 90\.000/);
    expect(differenceLabel(10000)).toMatch(/^Thừa 10\.000/);
    expect(differenceLabel(null)).toBe("Không xác định đơn");
    expect(differenceLabel(0)).toBe("Đủ");
  });

  it("translates reasons and statuses, passing unknown codes through", () => {
    expect(reasonLabel("AMOUNT_MISMATCH")).toBe("Lệch số tiền");
    expect(reasonLabel("???")).toBe("???");
    expect(statusLabel("OPEN")).toBe("Chờ xử lý");
  });

  it("requires a meaningful resolution note", () => {
    expect(validateResolutionNote("ok")).not.toBeNull();
    expect(validateResolutionNote("Đã hoàn tiền thừa cho khách")).toBeNull();
    expect(validateResolutionNote("x".repeat(1001))).not.toBeNull();
  });

  it("rejects malformed API responses", () => {
    expect(() => parseReconciliationPage({ items: [] })).toThrow();
    expect(parseReconciliationPage({ items: [], total: 0, openCount: 0, page: 1, limit: 20, totalPages: 1 }).total).toBe(0);
  });

  it("shows the menu to finance.read, payment.read or payment.manage holders only", () => {
    const has = (perms: string[]) => visibleAdminNavigation(perms, []).some(i => i.href === "/admin/payments/reconciliation");
    expect(has(["finance.read"])).toBe(true);
    expect(has(["payment.read"])).toBe(true);
    expect(has(["payment.manage"])).toBe(true);
    expect(has(["order.read"])).toBe(false);
  });
});
