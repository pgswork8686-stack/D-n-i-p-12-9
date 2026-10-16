import Link from "next/link";
import { SystemPage } from "@nexus/ui";

export const metadata = { title: "Không có quyền" };

/**
 * SY01 — admin access denied. The API is the authority (PermissionsGuard);
 * this page only explains a 403 it already returned.
 */
export default function ForbiddenPage() {
  return (
    <main id="main">
      <SystemPage
        code="403"
        title="Bạn không có quyền thực hiện thao tác này"
        description="Vai trò của tài khoản chưa được cấp quyền cho khu vực này. Liên hệ quản trị viên hệ thống nếu bạn cần truy cập."
        actions={
          <>
            <Link href="/" className="btn-primary">
              Về tổng quan
            </Link>
            <Link href="/login" className="btn-ghost">
              Đăng nhập tài khoản khác
            </Link>
          </>
        }
      />
    </main>
  );
}
