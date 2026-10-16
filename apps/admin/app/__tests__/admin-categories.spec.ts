import type { CategoryDto } from "@nexus/contracts";
import { flattenAdminCategories, validateAdminCategory } from "../lib/admin-categories";
const cat = (id: string, children: CategoryDto[] = []) => ({
  id, slug: id, name: id, children, status: "ACTIVE", sortOrder: 0, createdAt: "", updatedAt: "",
}) as CategoryDto;

describe("Admin category trees", () => {
  it("preserves hierarchy and depth", () => {
    expect(flattenAdminCategories([cat("root", [cat("child")])]).map(x => [x.category.id, x.depth])).toEqual([["root", 0], ["child", 1]]);
  });
  it("deduplicates malformed repeated nodes", () => {
    expect(flattenAdminCategories([cat("root"), cat("root")])).toHaveLength(1);
  });
  it("validates names and slugs", () => {
    expect(validateAdminCategory(" ", "valid")).not.toBeNull();
    expect(validateAdminCategory("Tên", "not VALID")).not.toBeNull();
    expect(validateAdminCategory("Tên", "theme-wordpress")).toBeNull();
  });
});
