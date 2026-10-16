import Link from "next/link";
import { SystemPage } from "@nexus/ui";

/** SY02 — admin 404. */
export default function NotFound() {
  return (
    <main id="main">
      <SystemPage
        code="404"
        title="Không tìm thấy trang quản trị"
        description="Đường dẫn không tồn tại hoặc bản ghi đã bị xóa."
        actions={
          <Link href="/" className="btn-primary">
            Về tổng quan vận hành
          </Link>
        }
      />
    </main>
  );
}
