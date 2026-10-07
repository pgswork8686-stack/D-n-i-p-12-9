import React from "react";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";
import {
  safeJsonLd,
  resolvePublicSiteUrl,
  buildProductMetadata,
  buildProductJsonLd,
} from "@nexus/utils";
import { ProductVariantSelector } from "./product-variant-selector";
import { fetchProductBySlug } from "../../lib/storefront-fetch";
import { FULFILLMENT_COPY, productTypeLabel } from "../../lib/format";

export const dynamic = "force-dynamic";

interface ProductPageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const product = await fetchProductBySlug(params.slug);
  const siteUrl = resolvePublicSiteUrl();
  const meta = buildProductMetadata({ product, siteUrl });
  // The shared builder already appends the brand; bypass the layout template.
  return { ...meta, title: meta.title ? { absolute: String(meta.title) } : undefined };
}

export default async function PublicProductDetailPage({ params }: ProductPageProps) {
  const product = await fetchProductBySlug(params.slug);
  if (!product) {
    notFound();
  }

  const siteUrl = resolvePublicSiteUrl();
  const productSchema = buildProductJsonLd({ product, siteUrl });
  const gallery: { id: string; url: string; altText?: string | null }[] = (product.media || []).filter(
    (m: any) => m.type !== "ICON",
  );
  const hero = gallery[0];

  return (
    <div className="container-site py-8 md:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(productSchema) }} />

      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/" className="hover:text-brand">
          Trang chủ
        </Link>
        <ChevronRight aria-hidden className="h-4 w-4" />
        <Link href="/products" className="hover:text-brand">
          Sản phẩm
        </Link>
        {product.categories?.[0] && (
          <>
            <ChevronRight aria-hidden className="h-4 w-4" />
            <Link href={`/products?category=${product.categories[0].slug}`} className="hover:text-brand">
              {product.categories[0].name}
            </Link>
          </>
        )}
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-8">
          <div className="card overflow-hidden">
            <div className="aspect-[16/10] bg-brand-soft">
              {hero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero.url} alt={hero.altText || product.name} className="h-full w-full object-cover" width={960} height={600} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Package aria-hidden className="h-16 w-16 text-brand/40" />
                </div>
              )}
            </div>
            {gallery.length > 1 && (
              <ul className="grid grid-cols-4 gap-2 border-t border-line p-2 sm:grid-cols-6">
                {gallery.slice(1, 7).map((m) => (
                  <li key={m.id} className="aspect-[4/3] overflow-hidden rounded-lg bg-brand-soft">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.altText || ""} loading="lazy" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-brand-soft px-3 py-1 font-medium text-brand">{productTypeLabel(product.productType)}</span>
              {product.brand && <span className="text-muted">bởi {product.brand}</span>}
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{product.name}</h1>
            {product.shortDescription && <p className="mt-4 text-lg leading-8 text-muted">{product.shortDescription}</p>}
          </div>

          <section aria-labelledby="desc-heading" className="card p-6 sm:p-8">
            <h2 id="desc-heading" className="text-xl font-semibold text-ink">
              Mô tả sản phẩm
            </h2>
            <p className="mt-4 whitespace-pre-line text-[17px] leading-8 text-ink/90">
              {product.description || "Thông tin chi tiết đang được cập nhật."}
            </p>
          </section>

          <section aria-labelledby="delivery-heading" className="card p-6 sm:p-8">
            <h2 id="delivery-heading" className="text-xl font-semibold text-ink">
              Nhận hàng như thế nào?
            </h2>
            <p className="mt-3 leading-7 text-muted">
              {FULFILLMENT_COPY[product.fulfillmentType] || "Quyền sử dụng được cấp tự động sau khi thanh toán thành công."}
            </p>
          </section>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <ProductVariantSelector product={product} />
        </div>
      </div>
    </div>
  );
}
