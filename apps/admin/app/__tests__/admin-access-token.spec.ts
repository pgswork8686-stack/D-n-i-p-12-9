import { effectiveAdminToken } from "../lib/admin-access-token";

describe("Admin real-session bearer token", () => {
  it("uses the verified session by default", () => {
    expect(effectiveAdminToken("supabase-jwt", null, false)).toBe("supabase-jwt");
    expect(effectiveAdminToken("supabase-jwt", null, true)).toBe("supabase-jwt");
  });
  it("ignores all fake-token overrides in production", () => {
    expect(effectiveAdminToken("supabase-jwt", "dev-admin-token", false)).toBe("supabase-jwt");
    expect(effectiveAdminToken("supabase-jwt", "", false)).toBe("supabase-jwt");
    expect(effectiveAdminToken(null, "dev-admin-token", false)).toBeNull();
  });
  it("respects explicitly chosen development impersonation only in dev mode", () => {
    expect(effectiveAdminToken("supabase-jwt", "dev-customer-token", true)).toBe("dev-customer-token");
    expect(effectiveAdminToken("supabase-jwt", "", true)).toBeNull();
  });
});
