import Link from "next/link";
import { SystemPage } from "@nexus/ui";

/** SY02 — storefront 404 (also used for unpublished posts and foreign orders). */
export default function NotFound() {
  return (
    <SystemPage
      code="404"
      title="Không tìm thấy trang"
      description="Trang bạn tìm có thể đã đổi địa chỉ, ngừng bán hoặc chưa được xuất bản."
      actions={
        <>
          <Link href="/products" className="btn-primary">
            Xem sản phẩm
          </Link>
          <Link href="/" className="btn-ghost">
            Về trang chủ
          </Link>
        </>
      }
    />
  );
}
