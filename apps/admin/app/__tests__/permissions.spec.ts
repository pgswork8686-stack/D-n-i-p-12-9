import * as fs from "fs";
import * as path from "path";
import { hasPermissions } from "../lib/permissions";

describe("admin permission checks (UI mirror of PermissionsGuard)", () => {
  it("denies anonymous users", () => {
    expect(hasPermissions(null, ["project.read"])).toBe(false);
  });

  it("lets super_admin through without explicit permissions", () => {
    expect(hasPermissions({ roles: ["super_admin"], permissions: [] }, ["project.manage"])).toBe(true);
  });

  it("requires every listed permission, like the API guard", () => {
    const supportAgent = { roles: ["support_agent"], permissions: ["inquiry.read", "inquiry.manage", "project.read"] };
    expect(hasPermissions(supportAgent, ["inquiry.manage"])).toBe(true);
    // Convert needs both inquiry.manage and project.manage.
    expect(hasPermissions(supportAgent, ["inquiry.manage", "project.manage"])).toBe(false);
    expect(hasPermissions({ roles: ["admin"], permissions: ["inquiry.manage", "project.manage"] }, ["inquiry.manage", "project.manage"])).toBe(true);
  });

  it("treats missing permission arrays as none", () => {
    expect(hasPermissions({ roles: ["customer"] }, ["service.manage"])).toBe(false);
  });
});

describe("services admin screens gate mutations by permission", () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

  it("convert requires both inquiry.manage and project.manage", () => {
    expect(read("service-inquiries/[id]/page.tsx")).toContain('can("inquiry.manage", "project.manage")');
  });

  it("irreversible project actions ask for confirmation", () => {
    const src = read("service-projects/[id]/page.tsx");
    expect(src).toContain('s === "COMPLETED" || s === "CANCELLED"');
    expect(src).toContain("confirmAction(`Remove");
    expect(src).toContain("Share \"${file.name}\" with the customer?");
  });
});
