import React from "react";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@nexus/ui";
import {
  safeJsonLd,
  resolvePublicSiteUrl,
  resolveApiUrl,
  buildProductMetadata,
  buildProductJsonLd,
} from "@nexus/utils";
import { ProductVariantSelector } from "./product-variant-selector";

export const dynamic = "force-dynamic";

interface ProductPageProps {
  params: { slug: string };
}

async function getProduct(slug: string): Promise<any | null> {
  const apiUrl = resolveApiUrl();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/products/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
  } catch {
    throw new Error("Unable to connect to product catalog service.");
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Product catalog service returned error: ${res.status}`);
  }

  return await res.json();
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  let product = null;
  try {
    product = await getProduct(params.slug);
  } catch (err) {
    throw err;
  }

  const siteUrl = resolvePublicSiteUrl();
  return buildProductMetadata({ product, siteUrl });
}

export default async function PublicProductDetailPage({ params }: ProductPageProps) {
  const product = await getProduct(params.slug);
  if (!product) {
    notFound();
  }

  const siteUrl = resolvePublicSiteUrl();
  const productSchema = buildProductJsonLd({ product, siteUrl });

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

