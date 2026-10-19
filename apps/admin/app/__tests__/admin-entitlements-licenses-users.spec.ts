import {
  ADMIN_ENTITLEMENT_PAGE_SIZE, adminEntitlementQuery, adminFulfillmentLabel,
  parseAdminEntitlementPage, validateRevokeReason,
} from "../lib/admin-entitlements";
import {
  ADMIN_LICENSE_PAGE_SIZE, maskedLicenseKey, parseAdminLicenseList, viewAdminLicenses,
} from "../lib/admin-licenses";
import {
  adminUserDisplayName, adminUserInitials, allAdminRoles, parseAdminUsers, viewAdminUsers,
} from "../lib/admin-users";

const lic = (i: number, status: "ACTIVE" | "REVOKED" = "ACTIVE") => ({
  id: "l" + i, entitlementId: "e" + i, userId: "u" + i, productId: "p" + i, variantId: "v" + i,
  status, keyLast4: String(1000 + i), maxActivations: 3, activeActivations: 1,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revokedAt: null,
});
const user = (id: string, email: string | null, roles: string[], displayName: string | null = null) => ({
  id, email, supabaseId: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  profile: displayName ? { displayName, firstName: null, lastName: null } : null, roles,
});

describe("AD11 Admin entitlements helpers", () => {
  it("allowlists status and fulfillment filters and bounds the page", () => {
    expect(adminEntitlementQuery(1, "ACTIVE", "INTERNAL_LICENSE")).toBe(
      "page=1&limit=" + ADMIN_ENTITLEMENT_PAGE_SIZE + "&status=ACTIVE&fulfillmentType=INTERNAL_LICENSE");
    expect(adminEntitlementQuery(0, "BOGUS" as any, "DROP TABLE")).toBe("page=1&limit=" + ADMIN_ENTITLEMENT_PAGE_SIZE);
  });
  it("rejects malformed paginated responses", () => {
    expect(() => parseAdminEntitlementPage({ items: [], total: 0 })).toThrow();
    expect(parseAdminEntitlementPage({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 }).total).toBe(0);
  });
  it("requires a revoke reason of sensible length", () => {
    expect(validateRevokeReason("  ")).not.toBeNull();
    expect(validateRevokeReason("ab")).not.toBeNull();
    expect(validateRevokeReason("Hoàn tiền theo yêu cầu")).toBeNull();
    expect(validateRevokeReason("x".repeat(501))).not.toBeNull();
  });
  it("labels fulfillment types and passes unknown ones through", () => {
    expect(adminFulfillmentLabel("INTERNAL_LICENSE")).toBe("License nội bộ");
    expect(adminFulfillmentLabel("NEW_TYPE")).toBe("NEW_TYPE");
  });
});

describe("AD12 Admin internal licenses helpers", () => {
  it("only accepts an array of license items", () => {
    expect(() => parseAdminLicenseList({ items: [] })).toThrow();
    expect(() => parseAdminLicenseList([{ nope: 1 }])).toThrow();
    expect(parseAdminLicenseList([lic(1)])).toHaveLength(1);
  });
  it("masks keys and never exposes more than the last four characters", () => {
    expect(maskedLicenseKey("19C4")).toBe("NXS-****-****-19C4");
    expect(maskedLicenseKey("")).toBe("NXS-****-****-????");
  });
  it("filters, searches and pages client-side", () => {
    const all = Array.from({ length: 45 }, (_, i) => lic(i, i % 5 === 0 ? "REVOKED" : "ACTIVE"));
    expect(viewAdminLicenses(all, "", "", 1).items).toHaveLength(ADMIN_LICENSE_PAGE_SIZE);
    expect(viewAdminLicenses(all, "", "", 3).items).toHaveLength(5);
    expect(viewAdminLicenses(all, "REVOKED", "", 1).total).toBe(9);
    expect(viewAdminLicenses(all, "", "1007", 1).items.map(x => x.id)).toEqual(["l7"]);
    expect(viewAdminLicenses(all, "", "", 99).page).toBe(3);
  });
});

describe("AD14 Admin users helpers", () => {
  it("unwraps the { status, count, users } envelope and validates it", () => {
    expect(() => parseAdminUsers({ users: null })).toThrow();
    expect(() => parseAdminUsers([])).toThrow();
    expect(parseAdminUsers({ status: "ok", count: 1, users: [user("u1", "a@b.c", ["customer"])] })).toHaveLength(1);
  });
  it("derives a display name and initials without inventing data", () => {
    expect(adminUserDisplayName(user("u1", "a@b.c", [], "Khách Demo A"))).toBe("Khách Demo A");
    expect(adminUserDisplayName(user("abcdef123456", null, []))).toBe("Người dùng abcdef12");
    expect(adminUserInitials(user("u1", "a@b.c", [], "Khách Demo A"))).toBe("KA");
  });
  it("collects roles and filters by role and text", () => {
    const users = [user("1", "a@x.vn", ["customer"], "An"), user("2", "b@x.vn", ["content_editor"], "Bình"), user("3", "c@x.vn", ["customer"], "Chi")];
    expect(allAdminRoles(users)).toEqual(["content_editor", "customer"]);
    expect(viewAdminUsers(users, "customer", "", 1).total).toBe(2);
    expect(viewAdminUsers(users, "", "bình", 1).items.map(u => u.id)).toEqual(["2"]);
  });
});
