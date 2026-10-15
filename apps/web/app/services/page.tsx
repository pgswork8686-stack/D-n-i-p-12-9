import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Bot, Code2, Plug, Puzzle, Workflow, MessageCircle } from "lucide-react";
import { listServices } from "../lib/server-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dịch vụ",
  description:
    "Thiết kế web app, phần mềm quản lý, AI chatbot, tự động hóa n8n/CRM và tích hợp API theo yêu cầu doanh nghiệp.",
};

const ICONS: Record<string, typeof Code2> = {
  "custom-web-app-development": Code2,
  "ai-chatbot-development": Bot,
  "facebook-messenger-automation": MessageCircle,
  "custom-plugin-development": Puzzle,
  "business-process-automation": Workflow,
  "api-integration": Plug,
};

export default async function ServicesPage() {
  const services = await listServices();
  // Module switched off on the backend: behave as if the page does not exist.
  if (services === null) notFound();

  return (
    <div className="container-site py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">Dịch vụ PGS</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Giải pháp phần mềm theo yêu cầu
        </h1>
        <p className="mt-3 text-muted">
          Từ web app, phần mềm quản lý đến chatbot AI và tự động hóa quy trình. Gửi yêu cầu, nhận tư vấn và báo giá
          theo từng milestone, theo dõi tiến độ ngay trên Customer Portal.
        </p>
      </header>

      {services.length === 0 ? (
        <div className="card mt-10 p-10 text-center text-muted">Danh mục dịch vụ đang được cập nhật.</div>
      ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => {
            const Icon = ICONS[s.slug] || Code2;
            return (
              <li key={s.id}>
                <Link
                  href={`/services/${s.slug}`}
                  className="card group flex h-full flex-col p-6 transition-colors hover:border-brand/40"
                >
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt="" className="mb-5 aspect-[16/9] w-full rounded-xl object-cover" loading="lazy" />
                  ) : (
                    <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <Icon aria-hidden className="h-6 w-6" />
                    </span>
                  )}
                  <h2 className="text-lg font-semibold text-ink group-hover:text-brand">{s.name}</h2>
                  <p className="mt-2 flex-1 text-sm leading-6 text-muted">{s.summary}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                    {s.pricingMode === "DIRECT_CHECKOUT" ? "Xem gói dịch vụ" : s.ctaLabel}
                    <ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
