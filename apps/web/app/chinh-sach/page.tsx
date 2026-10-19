import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { POLICY_PAGES, policyHref } from "../lib/policy-pages";
import { fetchPublishedPolicySlugs } from "../lib/storefront-fetch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chính sách" };

export default async function PolicyIndexPage() {
  const published = new Set(await fetchPublishedPolicySlugs(POLICY_PAGES.map((p) => p.slug), fetch, { noStore: true }));
  const pages = POLICY_PAGES.filter((p) => published.has(p.slug));

  return (
    <div className="container-site py-10 md:py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Chính sách</h1>
        <p className="mt-3 text-muted">Quy định về quyền riêng tư, thanh toán, giao nhận và hoàn tiền khi mua sản phẩm số tại NexusTheme.</p>

        {pages.length === 0 ? (
          <p role="status" className="mt-10 rounded-2xl border border-line bg-white p-8 text-muted">
            Các trang chính sách đang được hoàn thiện và sẽ sớm được công bố. Nếu cần hỗ trợ ngay, vui lòng gửi yêu cầu qua trang tài khoản.
          </p>
        ) : (
          <ul className="mt-10 divide-y divide-line rounded-2xl border border-line bg-white">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link href={policyHref(p.slug)} className="flex items-center justify-between gap-4 px-6 py-5 font-semibold text-ink hover:text-brand">
                  {p.title}
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
