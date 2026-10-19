export type AdminNavItem = { href: string; label: string; permission: string };

export const ADMIN_NAVIGATION: AdminNavItem[] = [
  { href: "/admin/products", label: "Sản phẩm", permission: "product.read" },
  { href: "/admin/orders", label: "Đơn hàng", permission: "order.read" },
  { href: "/admin/entitlements", label: "Quyền sử dụng", permission: "entitlement.read" },
  { href: "/admin/internal-licenses", label: "License nội bộ", permission: "license.read" },
  { href: "/admin/license-allocations", label: "License quản lý hộ", permission: "license.read" },
  { href: "/admin/users", label: "Khách hàng", permission: "user.read" },
  { href: "/admin/tickets", label: "Ticket hỗ trợ", permission: "ticket.read" },
  { href: "/service-inquiries", label: "Yêu cầu tư vấn", permission: "inquiry.read" },
  { href: "/content", label: "Nội dung CMS", permission: "content.read" },
  { href: "/automation", label: "Tự động hóa", permission: "automation.read" },
];

export function visibleAdminNavigation(
  permissions: string[] = [],
  roles: string[] = [],
): AdminNavItem[] {
  if (roles.includes("super_admin")) return ADMIN_NAVIGATION;
  const allowed = new Set(permissions);
  return ADMIN_NAVIGATION.filter(item => allowed.has(item.permission));
}
