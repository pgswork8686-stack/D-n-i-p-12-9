import React from "react";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@nexus/ui";
import { safeJsonLd, toMajorUnit, resolvePublicSiteUrl, resolveApiUrl } from "@nexus/utils";
import { ProductVariantSelector } from "./product-variant-selector";

interface ProductPageProps {
  params: { slug: string };
}

async function getProduct(slug: string): Promise<any | null> {
  const apiUrl = resolveApiUrl();
  try {
    const res = await fetch(`${apiUrl}/products/${slug}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const product = await getProduct(params.slug);
  if (!product) {
    return {
      title: "Product Not Found | NEXUSTHEME",
      description: "The requested product is unavailable.",
    };
  }

  const siteUrl = resolvePublicSiteUrl();
  const canonicalUrl = `${siteUrl}/products/${product.slug}`;
  const title = `${product.name} | NEXUSTHEME`;
  const description = product.shortDescription || product.description || "NEXUSTHEME digital product.";

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: "website",
      siteName: "NEXUSTHEME",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function PublicProductDetailPage({ params }: ProductPageProps) {
  const product = await getProduct(params.slug);
  if (!product) {
    notFound();
  }

  const siteUrl = resolvePublicSiteUrl();

  // Truthful Product JSON-LD structured data:
  // - Minor units converted to major units (USD 1200 -> 12, VND 299000 -> 299000)
  // - Only emit Offer when an active, non-zero price exists
  // - NO invented availability (e.g. InStock removed)
  // - NO fabricated ratings or reviews
  const validOffers = (product.variants || [])
    .map((v: any) => {
      const price = v.prices?.[0];
      if (!price || price.amount === undefined || price.amount === null || price.amount <= 0) {
        return null;
      }
      return {
        "@type": "Offer",
        price: toMajorUnit(price.amount, price.currency),
        priceCurrency: price.currency,
        url: `${siteUrl}/products/${product.slug}`,
      };
    })
    .filter(Boolean);

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription || product.description || undefined,
    brand: {
      "@type": "Brand",
      name: product.brand || "NEXUSTHEME",
    },
    ...(validOffers.length > 0 ? { offers: validOffers } : {}),
  };

  return (
    <main className="max-w-5xl mx-auto py-12 px-6 font-sans">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productSchema) }}
      />

      <Link href="/products" className="text-sm text-gray-500 hover:text-gray-700 block mb-6">
        ← Back to Catalog
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        {/* Main Details */}
        <div className="md:col-span-2 space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
              {product.brand || "Nexus"}
            </span>
            <Badge variant="info">{product.productType}</Badge>
            <Badge variant="warning">{product.fulfillmentType}</Badge>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
            {product.name}
          </h1>

          <p className="text-lg text-gray-600 leading-relaxed">
            {product.shortDescription}
          </p>

          <div className="prose text-sm text-gray-700 pt-6 border-t border-gray-100">
            <h3 className="text-base font-bold text-gray-900 mb-2">Product Overview</h3>
            <p className="whitespace-pre-line leading-relaxed">
              {product.description || "Comprehensive specifications available upon deployment."}
            </p>
          </div>

          {/* Categories */}
          {product.categories?.length > 0 && (
            <div className="pt-4 flex items-center gap-2">
              <span className="text-xs text-gray-400">Categories:</span>
              {product.categories.map((c: any) => (
                <span
                  key={c.id}
                  className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
                >
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Purchase / Variant Card (Client Interactive) */}
        <div>
          <ProductVariantSelector product={product} />
        </div>
      </div>
    </main>
  );
}

