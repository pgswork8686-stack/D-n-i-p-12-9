import { statusPresentation } from "../lib/status-labels";

describe("Portal Vietnamese status presentation", () => {
  it("uses the Figma wording and a non-color cue for orders", () => {
    expect(statusPresentation("PENDING_PAYMENT")).toEqual({ label: "Chờ thanh toán", tone: "warning", glyph: "!" });
    expect(statusPresentation("PAID")).toEqual({ label: "Đã thanh toán", tone: "success", glyph: "✓" });
    expect(statusPresentation("CANCELLED").label).toBe("Đã hủy");
  });
  it("reads ACTIVE differently for entitlements and licenses", () => {
    expect(statusPresentation("ACTIVE", "entitlement").label).toBe("Đang hiệu lực");
    expect(statusPresentation("ACTIVE", "license").label).toBe("Hoạt động");
    expect(statusPresentation("ACTIVE").label).toBe("Hoạt động");
  });
  it("covers every ticket and allocation status the API can return", () => {
    for (const s of ["OPEN", "WAITING_CUSTOMER", "WAITING_STAFF", "IN_PROGRESS", "RESOLVED", "CLOSED"]) {
      expect(statusPresentation(s, "ticket").label).not.toBe(s);
    }
    for (const s of ["PENDING", "ACTIVE", "DEACTIVATION_PENDING", "DEACTIVATED", "REJECTED"]) {
      expect(statusPresentation(s, "allocation").label).not.toBe(s);
    }
  });
  it("never invents a label for an unknown code", () => {
    expect(statusPresentation("MYSTERY_STATE")).toEqual({ label: "MYSTERY_STATE", tone: "info", glyph: "●" });
    expect(statusPresentation("pending_payment").label).toBe("Chờ thanh toán");
  });
});
