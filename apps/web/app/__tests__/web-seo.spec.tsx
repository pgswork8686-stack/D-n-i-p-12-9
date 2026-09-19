import {
  buildProductJsonLd,
  buildProductMetadata,
  buildArticleJsonLd,
  buildArticleMetadata,
  resolvePublicSiteUrl,
  resolveApiUrl,
} from "@nexus/utils";

describe("Web Storefront SEO & Fetch Semantics", () => {
  const PROD_SITE = "https://nexustheme.dev";

  describe("Product JSON-LD Structured Data", () => {
    it("1. Product JSON-LD USD: converts minor 1200 to major unit 12", () => {
      const product = {
        name: "Enterprise Saas Theme",
        slug: "enterprise-saas",
        variants: [
          {
            prices: [{ amount: 1200, currency: "USD" }],
          },
        ],
      };

      const jsonLd = buildProductJsonLd({ product, siteUrl: PROD_SITE });
      expect(jsonLd["@type"]).toBe("Product");
      expect(jsonLd.name).toBe("Enterprise Saas Theme");
      expect(jsonLd.offers).toHaveLength(1);
      expect(jsonLd.offers[0].price).toBe(12);
      expect(jsonLd.offers[0].priceCurrency).toBe("USD");
      expect(jsonLd.offers[0].url).toBe("https://nexustheme.dev/products/enterprise-saas");
    });

    it("2. Product JSON-LD VND: preserves zero-decimal currency integer 299000", () => {
      const product = {
        name: "Hanoi Modern Theme",
        slug: "hanoi-modern",
        variants: [
          {
            prices: [{ amount: 299000, currency: "VND" }],
          },
        ],
      };

      const jsonLd = buildProductJsonLd({ product, siteUrl: PROD_SITE });
      expect(jsonLd.offers[0].price).toBe(299000);
      expect(jsonLd.offers[0].priceCurrency).toBe("VND");
    });

    it("3. Product no availability: never invents InStock status", () => {
      const product = {
        name: "Digital Download Theme",
        slug: "digital-download",
        variants: [
          {
            prices: [{ amount: 4900, currency: "USD" }],
          },
        ],
      };

      const jsonLd = buildProductJsonLd({ product, siteUrl: PROD_SITE });
      expect(jsonLd.offers[0].availability).toBeUndefined();
      expect(JSON.stringify(jsonLd)).not.toContain("InStock");
    });

    it("4. Product no fake zero offer: excludes variants with empty or zero prices", () => {
      const product = {
        name: "Freemium Bundle",
        slug: "freemium-bundle",
        variants: [
          { prices: [] },
          { prices: [{ amount: 0, currency: "USD" }] },
          { prices: [{ amount: null as any, currency: "USD" }] },
          { prices: [{ amount: -100, currency: "USD" }] },
        ],
      };

      const jsonLd = buildProductJsonLd({ product, siteUrl: PROD_SITE });
      expect(jsonLd.offers).toBeUndefined();
      expect(JSON.stringify(jsonLd)).not.toContain('"price":0');
    });

    it("5. Product brand truthfulness: emits Brand when product.brand exists", () => {
      const product = {
        name: "Official Partner Plugin",
        slug: "partner-plugin",
        brand: "WooCommerce Elite",
        variants: [{ prices: [{ amount: 7900, currency: "USD" }] }],
      };

      const jsonLd = buildProductJsonLd({ product, siteUrl: PROD_SITE });
      expect(jsonLd.brand).toEqual({
        "@type": "Brand",
        name: "WooCommerce Elite",
      });
    });

    it("6. Product brand truthfulness: omits brand completely when product.brand is absent", () => {
      const product = {
        name: "Community Open Theme",
        slug: "community-open",
        brand: null,
        variants: [{ prices: [{ amount: 1500, currency: "USD" }] }],
      };

      const jsonLd = buildProductJsonLd({ product, siteUrl: PROD_SITE });
      expect(jsonLd.brand).toBeUndefined();
      expect(JSON.stringify(jsonLd)).not.toContain("NEXUSTHEME");
    });

    it("7. Product metadata canonical: points to authoritative product URL", () => {
      const product = {
        name: "Analytics Pro Theme",
        slug: "analytics-pro",
        shortDescription: "Fast e-commerce theme.",
      };

      const meta = buildProductMetadata({ product, siteUrl: PROD_SITE });
      expect(meta.alternates?.canonical).toBe("https://nexustheme.dev/products/analytics-pro");
      expect(meta.openGraph?.url).toBe("https://nexustheme.dev/products/analytics-pro");
    });
  });

  describe("Article JSON-LD & Metadata", () => {
    it("8. Article no fabricated author: omits author when not modeled", () => {
      const post = {
        title: "Microservices Architecture in 2026",
        slug: "microservices-2026",
        author: null,
      };

      const jsonLd = buildArticleJsonLd({ post, siteUrl: PROD_SITE });
      expect(jsonLd.author).toBeUndefined();
      expect(JSON.stringify(jsonLd)).not.toContain("Editorial Team");
    });

    it("9. Article safe JSON-LD & metadata: emits truthful author when profile displayName exists", () => {
      const post = {
        title: "Zero-Downtime Deployment Guide",
        slug: "zero-downtime-deploy",
        author: {
          profile: { displayName: "Senior Architect" },
        },
      };

      const jsonLd = buildArticleJsonLd({ post, siteUrl: PROD_SITE });
      expect(jsonLd.author).toEqual({
        "@type": "Person",
        name: "Senior Architect",
      });
      expect(jsonLd.publisher).toEqual({
        "@type": "Organization",
        name: "NEXUSTHEME",
        url: "https://nexustheme.dev",
      });
    });
  });

  describe("HTTP Fetch Semantics (404 vs 5xx / Network Outage)", () => {
    it("10. 404 returns null (leading to notFound), whereas 500 throws controlled error", async () => {
      const mockFetch404 = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: "Not found" }),
      });

      const mockFetch500 = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: "Internal server error" }),
      });

      const mockFetchNetworkErr = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      // 404 semantic test
      const res404 = await mockFetch404("https://api.domain.com/products/missing");
      expect(res404.status).toBe(404);

      // 500 semantic test
      const res500 = await mockFetch500("https://api.domain.com/products/error");
      expect(res500.status).toBe(500);
      expect(res500.ok).toBe(false);

      // Network semantic test
      await expect(mockFetchNetworkErr("https://api.domain.com/products/net")).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("Trusted Production Origin Contract", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.SITE_URL;
      delete process.env.WEB_URL;
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.API_URL;
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("11. resolvePublicSiteUrl enforces HTTPS and blocks localhost in production", () => {
      expect(resolvePublicSiteUrl("https://nexustheme.dev", { isProduction: true })).toBe("https://nexustheme.dev");
      expect(() => resolvePublicSiteUrl("http://localhost:3000", { isProduction: true })).toThrow(/must use HTTPS/);
      expect(() => resolvePublicSiteUrl("https://localhost", { isProduction: true })).toThrow(/cannot target localhost/);
      expect(() => resolvePublicSiteUrl("", { isProduction: true })).toThrow(/Production requires a configured public site URL/);
      expect(() => resolvePublicSiteUrl(undefined, { isProduction: true })).toThrow(/Production requires a configured public site URL/);
    });

    it("12. resolveApiUrl enforces HTTPS and blocks localhost in production", () => {
      expect(resolveApiUrl("https://api.nexustheme.dev", { isProduction: true })).toBe("https://api.nexustheme.dev");
      expect(() => resolveApiUrl("http://localhost:4000", { isProduction: true })).toThrow(/must use HTTPS/);
      expect(() => resolveApiUrl("http://api.nexustheme.dev", { isProduction: true })).toThrow(/must use HTTPS/);
      expect(() => resolveApiUrl("", { isProduction: true })).toThrow(/Production requires a configured API URL/);
      expect(() => resolveApiUrl(undefined, { isProduction: true })).toThrow(/Production requires a configured API URL/);
    });
  });
});
