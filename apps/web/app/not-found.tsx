import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-site flex min-h-[60vh] items-center justify-center py-16">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-brand">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Không tìm thấy trang</h1>
        <p className="mt-3 text-muted">Trang bạn tìm có thể đã bị đổi tên hoặc không còn tồn tại.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/products" className="btn-primary">
            Xem sản phẩm
          </Link>
          <Link href="/" className="btn-ghost">
            Về trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
