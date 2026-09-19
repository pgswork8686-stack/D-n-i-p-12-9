import { buildProductJsonLd, buildProductMetadata } from "./product-seo";

describe("Product SEO Builder", () => {
  const siteUrl = "https://nexustheme.dev";

  it("converts USD minor currency to decimal major unit (1200 -> 12)", () => {
    const product = {
      name: "Modern Agency Theme",
      slug: "modern-agency",
      variants: [
        {
          prices: [{ amount: 1200, currency: "USD" }],
        },
      ],
    };

    const jsonLd = buildProductJsonLd({ product, siteUrl });
    expect(jsonLd["@type"]).toBe("Product");
    expect(jsonLd.name).toBe("Modern Agency Theme");
    expect(jsonLd.offers).toHaveLength(1);
    expect(jsonLd.offers[0].price).toBe(12);
    expect(jsonLd.offers[0].priceCurrency).toBe("USD");
    expect(jsonLd.offers[0].url).toBe("https://nexustheme.dev/products/modern-agency");
  });

  it("converts VND minor currency correctly without decimal division (299000 -> 299000)", () => {
    const product = {
      name: "Saigon Minimalist Theme",
      slug: "saigon-minimalist",
      variants: [
        {
          prices: [{ amount: 299000, currency: "VND" }],
        },
      ],
    };

    const jsonLd = buildProductJsonLd({ product, siteUrl });
    expect(jsonLd.offers[0].price).toBe(299000);
    expect(jsonLd.offers[0].priceCurrency).toBe("VND");
  });

  it("omits availability entirely (never invents InStock)", () => {
    const product = {
      name: "Inventory Agnostic Plugin",
      slug: "plugin",
      variants: [{ prices: [{ amount: 4900, currency: "USD" }] }],
    };

    const jsonLd = buildProductJsonLd({ product, siteUrl });
    expect(jsonLd.offers[0].availability).toBeUndefined();
    expect(JSON.stringify(jsonLd)).not.toContain("InStock");
  });

  it("does not emit zero-price fake offers for variant without valid price", () => {
    const product = {
      name: "Unpriced Variant Theme",
      slug: "unpriced-theme",
      variants: [
        { prices: [] },
        { prices: [{ amount: 0, currency: "USD" }] },
        { prices: [{ amount: null as any, currency: "USD" }] },
      ],
    };

    const jsonLd = buildProductJsonLd({ product, siteUrl });
    expect(jsonLd.offers).toBeUndefined();
    expect(JSON.stringify(jsonLd)).not.toContain('"price":0');
  });

  it("brand truthfulness: emits Brand when product.brand exists", () => {
    const product = {
      name: "Branded Theme",
      slug: "branded-theme",
      brand: "Acme Corp",
      variants: [{ prices: [{ amount: 1900, currency: "USD" }] }],
    };

    const jsonLd = buildProductJsonLd({ product, siteUrl });
    expect(jsonLd.brand).toEqual({
      "@type": "Brand",
      name: "Acme Corp",
    });
  });

  it("brand truthfulness: completely omits brand when product.brand is absent (no fabricated NEXUSTHEME)", () => {
    const product = {
      name: "Unbranded Theme",
      slug: "unbranded-theme",
      brand: null,
      variants: [{ prices: [{ amount: 1900, currency: "USD" }] }],
    };

    const jsonLd = buildProductJsonLd({ product, siteUrl });
    expect(jsonLd.brand).toBeUndefined();
    expect(JSON.stringify(jsonLd)).not.toContain("Brand");
    expect(JSON.stringify(jsonLd)).not.toContain("NEXUSTHEME");
  });

  it("builds correct product metadata with canonical URL", () => {
    const product = {
      name: "Pro WooCommerce Suite",
      slug: "pro-woo-suite",
      shortDescription: "Ultra-fast WooCommerce templates.",
    };

    const meta = buildProductMetadata({ product, siteUrl });
    expect(meta.title).toBe("Pro WooCommerce Suite | NEXUSTHEME");
    expect(meta.description).toBe("Ultra-fast WooCommerce templates.");
    expect(meta.alternates?.canonical).toBe("https://nexustheme.dev/products/pro-woo-suite");
    expect(meta.openGraph?.url).toBe("https://nexustheme.dev/products/pro-woo-suite");
  });
});
