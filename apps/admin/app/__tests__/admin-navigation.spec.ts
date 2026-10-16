import { ADMIN_NAVIGATION, visibleAdminNavigation } from "../lib/admin-navigation";

describe("B5 Admin dashboard permission navigation", () => {
  it("shows nothing without a confirmed permission", () => {
    expect(visibleAdminNavigation([], [])).toEqual([]);
  });
  it("restricts navigation to permissions returned by /auth/me", () => {
    const x = visibleAdminNavigation(["order.read", "content.read"], ["staff"]);
    expect(x.map(y => y.href)).toEqual(["/admin/orders", "/content"]);
  });
  it("shows modules for verified super_admin", () => {
    expect(visibleAdminNavigation([], ["super_admin"])).toEqual(ADMIN_NAVIGATION);
  });
  it("never references unimplemented Admin links", () => {
    expect(ADMIN_NAVIGATION.every(x => x.href.startsWith("/") && x.permission.endsWith(".read"))).toBe(true);
  });
});
