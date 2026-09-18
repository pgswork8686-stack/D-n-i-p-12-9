export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
}

export interface BuildSitemapOptions {
  siteUrl: string;
  apiUrl: string;
  fetchFn?: (url: string, init?: any) => Promise<any>;
  maxUrlsCap?: number;
}

/**
 * Bounded sitemap entry generator.
 * Paginates through published articles and active catalog products,
 * capping at maxUrlsCap (default: 10,000) to prevent infinite loops.
 */
export async function buildSitemapEntries(
  options: BuildSitemapOptions,
): Promise<SitemapEntry[]> {
  const { siteUrl, apiUrl, fetchFn = fetch, maxUrlsCap = 10000 } = options;
  const baseUrl = siteUrl.replace(/\/$/, "");
  const baseApi = apiUrl.replace(/\/$/, "");

  const entries: SitemapEntry[] = [
    {
      url: `${baseUrl}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/products`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  // 1. Fetch paginated published articles (ARTICLE only)
  try {
    let page = 1;
    const limit = 50;
    let hasMore = true;

    while (hasMore && entries.length < maxUrlsCap) {
      const res = await fetchFn(
        `${baseApi}/v1/content/posts?page=${page}&limit=${limit}`,
        { cache: "no-store" },
      );
      if (!res.ok) break;

      const data: any = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      for (const item of items) {
        if (item.slug && entries.length < maxUrlsCap) {
          entries.push({
            url: `${baseUrl}/blog/${item.slug}`,
            lastModified: item.publishedAt ? new Date(item.publishedAt) : new Date(),
            changeFrequency: "weekly",
            priority: 0.7,
          });
        }
      }

      if (
        items.length < limit ||
        (data.totalPages && page >= data.totalPages) ||
        page >= 200
      ) {
        hasMore = false;
      } else {
        page++;
      }
    }
  } catch {
    // Graceful fallback during static build without active API
  }

  // 2. Fetch paginated active products
  try {
    let page = 1;
    const limit = 50;
    let hasMore = true;

    while (hasMore && entries.length < maxUrlsCap) {
      const res = await fetchFn(
        `${baseApi}/products?page=${page}&limit=${limit}`,
        { cache: "no-store" },
      );
      if (!res.ok) break;

      const data: any = await res.json();
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      for (const item of items) {
        if (item.slug && entries.length < maxUrlsCap) {
          entries.push({
            url: `${baseUrl}/products/${item.slug}`,
            lastModified: item.updatedAt ? new Date(item.updatedAt) : new Date(),
            changeFrequency: "weekly",
            priority: 0.8,
          });
        }
      }

      if (
        items.length < limit ||
        (data.totalPages && page >= data.totalPages) ||
        page >= 200
      ) {
        hasMore = false;
      } else {
        page++;
      }
    }
  } catch {
    // Graceful fallback
  }

  // 3. Fetch content categories
  try {
    const res = await fetchFn(`${baseApi}/v1/content/categories`, {
      cache: "no-store",
    });
    if (res.ok) {
      const categories: any = await res.json();
      if (Array.isArray(categories)) {
        for (const cat of categories) {
          if (cat.slug && entries.length < maxUrlsCap) {
            entries.push({
              url: `${baseUrl}/blog/category/${cat.slug}`,
              lastModified: cat.updatedAt ? new Date(cat.updatedAt) : new Date(),
              changeFrequency: "weekly",
              priority: 0.6,
            });
          }
        }
      }
    }
  } catch {
    // Graceful fallback
  }

  return entries;
}

export interface RobotsPolicy {
  rules: Array<{
    userAgent: string | string[];
    allow?: string | string[];
    disallow?: string | string[];
  }>;
  sitemap: string;
}

/**
 * Authoritative production robots.txt policy builder.
 */
export function buildRobotsPolicy(options: { siteUrl: string }): RobotsPolicy {
  const baseUrl = options.siteUrl.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/blog", "/products"],
        disallow: [
          "/cart",
          "/checkout",
          "/orders/",
          "/account",
          "/api/",
          "/admin/",
          "/portal/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
