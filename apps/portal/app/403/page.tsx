import Link from "next/link";
import { SystemPage } from "@nexus/ui";

export const metadata = { title: "Không có quyền truy cập" };

/** SY01 — portal access denied. */
export default function ForbiddenPage() {
  return (
    <main id="main">
      <SystemPage
        code="403"
        title="Bạn không có quyền truy cập"
        description="Tài khoản hiện tại không được phép xem nội dung này. Nếu bạn dùng nhiều tài khoản, hãy đăng nhập đúng tài khoản đã mua hàng."
        actions={
          <>
            <Link href="/" className="btn-primary">
              Về trang tổng quan
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
