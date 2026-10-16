import Link from "next/link";
import { SystemPage } from "@nexus/ui";

/** SY02 — portal 404. Records owned by another customer also land here. */
export default function NotFound() {
  return (
    <main id="main">
      <SystemPage
        code="404"
        title="Không tìm thấy nội dung"
        description="Trang hoặc bản ghi này không tồn tại, hoặc không thuộc tài khoản của bạn."
        actions={
          <>
            <Link href="/" className="btn-primary">
              Về trang tổng quan
            </Link>
            <Link href="/orders" className="btn-ghost">
              Xem đơn hàng
            </Link>
          </>
        }
      />
    </main>
  );
}
