import { toMajorUnit } from "./money";

export interface ProductPrice {
  amount?: number | null;
  currency: string;
}

export interface ProductVariantInput {
  id?: string;
  sku?: string;
  name?: string;
  prices?: ProductPrice[];
}

export interface ProductInput {
  name: string;
  slug: string;
  description?: string | null;
  shortDescription?: string | null;
  brand?: string | null;
  variants?: ProductVariantInput[];
}

export interface BuildProductJsonLdOptions {
  product: ProductInput;
  siteUrl: string;
}

export interface BuildProductMetadataOptions {
  product: ProductInput | null;
  siteUrl: string;
}

/**
 * Builds truthful Schema.org Product JSON-LD structured data.
 * - Minor units converted to decimal major units (USD 1200 -> 12, VND 299000 -> 299000)
 * - Only emit Offer when an active, positive price exists (NO price: 0, NO fake currency)
 * - NO invented availability (availability is strictly omitted since catalog has no authoritative inventory status)
 * - Brand truthfulness: emit Brand only if product.brand exists and is non-empty; omit brand entirely if absent
 */
export function buildProductJsonLd({
  product,
  siteUrl,
}: BuildProductJsonLdOptions): Record<string, any> {
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");

  const validOffers: Array<{
    "@type": "Offer";
    price: number;
    priceCurrency: string;
    url: string;
  }> = [];

  for (const variant of product.variants || []) {
    for (const price of variant.prices || []) {
      if (
        price &&
        typeof price.amount === "number" &&
        price.amount > 0 &&
        price.currency
      ) {
        validOffers.push({
          "@type": "Offer",
          price: toMajorUnit(price.amount, price.currency),
          priceCurrency: price.currency,
          url: `${normalizedSiteUrl}/products/${product.slug}`,
        });
      }
    }
  }

  const schema: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
  };

  const desc = product.shortDescription || product.description;
  if (desc) {
    schema.description = desc;
  }

  // Brand truthfulness:
  // Only emit brand if explicitly provided. Never fabricate "NEXUSTHEME" as brand.
  if (product.brand && product.brand.trim()) {
    schema.brand = {
      "@type": "Brand",
      name: product.brand.trim(),
    };
  }

  if (validOffers.length > 0) {
    schema.offers = validOffers;
  }

  return schema;
}

/**
 * Builds metadata for product details page.
 */
export function buildProductMetadata({
  product,
  siteUrl,
}: BuildProductMetadataOptions) {
  if (!product) {
    return {
      title: "Product Not Found | NEXUSTHEME",
      description: "The requested product is unavailable.",
    };
  }

  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
  const canonicalUrl = `${normalizedSiteUrl}/products/${product.slug}`;
  const title = `${product.name} | NEXUSTHEME`;
  const description =
    product.shortDescription ||
    product.description ||
    "NEXUSTHEME digital product.";

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
