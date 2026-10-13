import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

/**
 * ST01 R8 when FEATURE_CONSULT_FORM_DEMO is off (production): only real
 * channels. Support tickets in the customer portal are the working way to
 * reach the team today; browsing the catalog needs no account.
 */
export function ConsultCta() {
  return (
    <div className="rounded-2xl bg-surface p-6 text-left shadow-lift sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <MessageCircle className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-ink">Gửi câu hỏi cho đội ngũ kỹ thuật</p>
          <p className="mt-1 text-sm leading-6 text-body">
            Đăng nhập tài khoản và tạo yêu cầu hỗ trợ — mô tả website bạn cần, chúng tôi phản hồi ngay trong mục Hỗ trợ.
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a href={`${PORTAL_URL}/tickets`} className="btn-primary">
          Gửi yêu cầu tư vấn
          <ArrowRight aria-hidden className="h-4 w-4" />
        </a>
        <Link href="/products" className="btn-ghost">
          Tự xem sản phẩm
        </Link>
      </div>
    </div>
  );
}
