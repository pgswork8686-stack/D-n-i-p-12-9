import { buildArticleJsonLd, buildArticleMetadata } from "./article-seo";

describe("Article SEO Builder", () => {
  const siteUrl = "https://nexustheme.dev";

  it("truthful author: omits author when no public name or displayName is modeled", () => {
    const post = {
      title: "Optimizing Next.js SSR Performance",
      slug: "nextjs-ssr-perf",
      author: null,
    };

    const jsonLd = buildArticleJsonLd({ post, siteUrl });
    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd.headline).toBe("Optimizing Next.js SSR Performance");
    expect(jsonLd.author).toBeUndefined();
    expect(JSON.stringify(jsonLd)).not.toContain("Editorial Team");
  });

  it("truthful author: emits Person when author has valid displayName", () => {
    const post = {
      title: "Advanced Database Indexing",
      slug: "db-indexing",
      author: {
        profile: {
          displayName: "Jane Developer",
        },
      },
    };

    const jsonLd = buildArticleJsonLd({ post, siteUrl });
    expect(jsonLd.author).toEqual({
      "@type": "Person",
      name: "Jane Developer",
    });
  });

  it("builds truthful publisher and canonical URL", () => {
    const post = {
      title: "Clean Architecture Guide",
      slug: "clean-arch",
      publishedAt: "2026-09-18T10:00:00.000Z",
      updatedAt: "2026-09-18T12:00:00.000Z",
    };

    const jsonLd = buildArticleJsonLd({ post, siteUrl });
    expect(jsonLd.mainEntityOfPage["@id"]).toBe("https://nexustheme.dev/blog/clean-arch");
    expect(jsonLd.publisher).toEqual({
      "@type": "Organization",
      name: "NEXUSTHEME",
      url: "https://nexustheme.dev",
    });
    expect(jsonLd.datePublished).toBe("2026-09-18T10:00:00.000Z");
  });

  it("builds article metadata correctly", () => {
    const post = {
      title: "Enterprise SEO Patterns",
      slug: "enterprise-seo",
      seoTitle: "Enterprise SEO Guide 2026",
      excerpt: "Deep dive into metadata and canonical standards.",
    };

    const meta = buildArticleMetadata({ post, siteUrl });
    expect(meta.title).toBe("Enterprise SEO Guide 2026 | NEXUSTHEME");
    expect(meta.alternates?.canonical).toBe("https://nexustheme.dev/blog/enterprise-seo");
  });
});
