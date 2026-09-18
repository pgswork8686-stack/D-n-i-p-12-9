import { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/products`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  // Fetch published products
  try {
    const res = await fetch(`${API_URL}/products`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : data.items || [];
      for (const item of items) {
        if (item.slug) {
          routes.push({
            url: `${SITE_URL}/products/${item.slug}`,
            lastModified: item.updatedAt ? new Date(item.updatedAt) : new Date(),
            changeFrequency: "weekly",
            priority: 0.8,
          });
        }
      }
    }
  } catch {
    // Graceful fallback during static build without backend
  }

  // Fetch published blog posts
  try {
    const res = await fetch(`${API_URL}/v1/content/posts?limit=100`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const posts = Array.isArray(data) ? data : data.items || [];
      for (const post of posts) {
        if (post.slug) {
          routes.push({
            url: `${SITE_URL}/blog/${post.slug}`,
            lastModified: post.updatedAt ? new Date(post.updatedAt) : new Date(),
            changeFrequency: "weekly",
            priority: 0.7,
          });
        }
      }
    }
  } catch {
    // Graceful fallback
  }

  // Fetch content categories
  try {
    const res = await fetch(`${API_URL}/v1/content/categories`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const categories = Array.isArray(data) ? data : [];
      for (const cat of categories) {
        if (cat.slug) {
          routes.push({
            url: `${SITE_URL}/blog/category/${cat.slug}`,
            lastModified: cat.updatedAt ? new Date(cat.updatedAt) : new Date(),
            changeFrequency: "weekly",
            priority: 0.6,
          });
        }
      }
    }
  } catch {
    // Graceful fallback
  }

  return routes;
}
