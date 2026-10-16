import type { CategoryDto } from "@nexus/contracts";

/** API returns an ordered hierarchy; avoid cyclic/duplicate display. */
export function flattenAdminCategories(nodes: CategoryDto[]) {
  const result: { category: CategoryDto; depth: number }[] = [];
  const seen = new Set<string>();
  function walk(category: CategoryDto, depth: number) {
    if (seen.has(category.id)) return;
    seen.add(category.id);
    result.push({ category, depth });
    for (const child of category.children || []) walk(child, depth + 1);
  }
  nodes.forEach(category => walk(category, 0));
  return result;
}

export function validateAdminCategory(name: string, slug: string): string | null {
  if (!name.trim()) return "Tên danh mục không được để trống.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Slug chỉ gồm chữ thường, số và dấu gạch nối.";
  return null;
}
