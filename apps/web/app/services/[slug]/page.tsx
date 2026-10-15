import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { getService } from "../../lib/server-api";
import { InquiryForm } from "./inquiry-form";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Metadata must not take the page down: outages are reported by the page body.
  const service = await getService(params.slug).catch(() => null);
  if (!service) return { title: "Dịch vụ" };
  return { title: service.name, description: service.summary };
}

export default async function ServiceDetailPage({ params }: Props) {
  const service = await getService(params.slug);
  if (!service) notFound();

  const directCheckout = service.pricingMode === "DIRECT_CHECKOUT" && service.productSlug;

  return (
    <div className="container-site py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/" className="hover:text-brand">
          Trang chủ
        </Link>
        <ChevronRight aria-hidden className="h-4 w-4" />
        <Link href="/services" className="hover:text-brand">
          Dịch vụ
        </Link>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_440px]">
        <div className="min-w-0 space-y-8">
          <div>
            <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
              {directCheckout ? "Gói dịch vụ" : "Báo giá theo yêu cầu"}
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{service.name}</h1>
            <p className="mt-4 text-lg leading-8 text-muted">{service.summary}</p>
          </div>

          {service.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={service.imageUrl} alt="" className="card aspect-[16/9] w-full object-cover" width={960} height={540} />
          )}

          <section aria-labelledby="about-heading" className="card p-6 sm:p-8">
            <h2 id="about-heading" className="text-xl font-semibold text-ink">
              Giới thiệu
            </h2>
            <p className="mt-4 whitespace-pre-line text-[17px] leading-8 text-ink/90">{service.description}</p>
          </section>

          {service.features.length > 0 && (
            <section aria-labelledby="features-heading" className="card p-6 sm:p-8">
              <h2 id="features-heading" className="text-xl font-semibold text-ink">
                Tính năng
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {service.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-ink/90">
                    <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-cta" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {service.processSteps.length > 0 && (
            <section aria-labelledby="process-heading" className="card p-6 sm:p-8">
              <h2 id="process-heading" className="text-xl font-semibold text-ink">
                Quy trình làm việc
              </h2>
              <ol className="mt-5 space-y-5">
                {service.processSteps.map((step, i) => (
                  <li key={`${i}-${step.title}`} className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold text-ink">{step.title}</h3>
                      {step.description && <p className="mt-1 text-sm leading-6 text-muted">{step.description}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside id="inquiry" className="lg:sticky lg:top-24 lg:self-start">
          {directCheckout ? (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-ink">Mua gói dịch vụ</h2>
              <p className="mt-2 text-sm text-muted">Gói này có giá cố định và thanh toán trực tuyến như sản phẩm.</p>
              <Link href={`/products/${service.productSlug}`} className="btn-buy mt-5 w-full">
                {service.ctaLabel}
              </Link>
              <p className="mt-4 text-xs text-muted">Cần tùy chỉnh thêm? Gửi yêu cầu bên dưới.</p>
              <div className="mt-4 border-t border-line pt-4">
                <InquiryForm serviceSlug={service.slug} ctaLabel="Gửi yêu cầu tùy chỉnh" />
              </div>
            </div>
          ) : (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-ink">Gửi yêu cầu dự án</h2>
              <p className="mt-2 text-sm text-muted">Chúng tôi phản hồi trong 1 ngày làm việc.</p>
              <div className="mt-5">
                <InquiryForm serviceSlug={service.slug} ctaLabel={service.ctaLabel} />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
