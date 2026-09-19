import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card } from "@nexus/ui";
import { resolvePublicSiteUrl, resolveApiUrl } from "@nexus/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = resolvePublicSiteUrl();
  return {
    title: "Blog & Technical Guides | NEXUSTHEME",
    description:
      "Engineering guides, architectural patterns, and WooCommerce theme & plugin optimization insights.",
    alternates: {
      canonical: `${siteUrl}/blog`,
    },
    openGraph: {
      title: "Blog & Technical Guides | NEXUSTHEME",
      description:
        "Engineering guides, architectural patterns, and WooCommerce theme & plugin optimization insights.",
      url: `${siteUrl}/blog`,
      siteName: "NEXUSTHEME",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Blog & Technical Guides | NEXUSTHEME",
      description:
        "Engineering guides, architectural patterns, and WooCommerce theme & plugin optimization insights.",
    },
  };
}

interface BlogPageProps {
  searchParams: Promise<{ category?: string; page?: string }>;
}

async function getBlogData(categorySlug?: string, page: number = 1) {
  const apiUrl = resolveApiUrl();
  const params = new URLSearchParams();
  if (categorySlug) params.set("categorySlug", categorySlug);
  params.set("page", page.toString());
  params.set("limit", "12");

  try {
    const [postsRes, catsRes] = await Promise.all([
      fetch(`${apiUrl}/v1/content/posts?${params.toString()}`, {
        cache: "no-store",
      }),
      fetch(`${apiUrl}/v1/content/categories`, {
        cache: "no-store",
      }),
    ]);

    const postsData = postsRes.ok ? await postsRes.json() : { items: [], total: 0 };
    const categories = catsRes.ok ? await catsRes.json() : [];

    return {
      posts: postsData.items || [],
      total: postsData.total || 0,
      totalPages: postsData.totalPages || 1,
      categories: Array.isArray(categories) ? categories : [],
    };
  } catch {
    return {
      posts: [],
      total: 0,
      totalPages: 1,
      categories: [],
    };
  }
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { category, page } = await searchParams;
  const currentPage = Number(page) || 1;
  const { posts, categories, totalPages, total } = await getBlogData(category, currentPage);

  return (
    <main className="max-w-6xl mx-auto py-12 px-6 font-sans">
      <div className="mb-10 text-center max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight">
          NEXUSTHEME Blog & Guides
        </h1>
        <p className="text-sm md:text-base text-gray-500 mt-2">
          Technical deep-dives, WordPress architecture, and high-performance WooCommerce engineering.
        </p>
      </div>

      {/* Categories Filter Bar */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          <Link
            href="/blog"
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
              !category
                ? "bg-[#0037b0] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All Articles ({total})
          </Link>
          {categories.map((cat: any) => (
            <Link
              key={cat.id}
              href={`/blog?category=${cat.slug}`}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                category === cat.slug
                  ? "bg-[#0037b0] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="p-16 text-center bg-gray-50 rounded-2xl border border-gray-200 max-w-md mx-auto">
          <div className="text-4xl mb-3">📰</div>
          <h2 className="text-lg font-bold text-gray-800">No Articles Yet</h2>
          <p className="text-xs text-gray-500 mt-1">
            {category
              ? `No published articles in this category yet.`
              : "Check back soon for new articles and technical updates."}
          </p>
          {category && (
            <Link href="/blog" className="inline-block mt-4 text-xs font-semibold text-[#0037b0] underline">
              ← View all articles
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post: any) => (
            <article
              key={post.id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              {post.featuredImageUrl ? (
                <div className="h-48 w-full overflow-hidden bg-gray-100">
                  <img
                    src={post.featuredImageUrl}
                    alt={post.featuredImageAlt || post.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="h-32 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center text-blue-300 text-2xl font-bold">
                  NEXUSTHEME
                </div>
              )}

              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-xs">
                    {post.category && (
                      <Badge variant="info">
                        {post.category.name}
                      </Badge>
                    )}
                    {post.readingTimeMinutes && (
                      <span className="text-gray-400">
                        {post.readingTimeMinutes} min read
                      </span>
                    )}
                  </div>

                  <h2 className="text-lg font-bold text-gray-900 line-clamp-2 hover:text-[#0037b0] transition-colors">
                    <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                  </h2>

                  {post.excerpt && (
                    <p className="text-xs text-gray-600 mt-2 line-clamp-3 leading-relaxed">
                      {post.excerpt}
                    </p>
                  )}
                </div>

                <div className="pt-4 mt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                  <span>
                    {post.publishedAt
                      ? new Date(post.publishedAt).toLocaleDateString("vi-VN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "Recently"}
                  </span>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="font-semibold text-[#0037b0] hover:underline"
                  >
                    Read Article →
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 mt-12 text-xs">
          <Link
            href={`/blog?page=${Math.max(1, currentPage - 1)}${category ? `&category=${category}` : ""}`}
            className={`px-3 py-1.5 rounded border ${
              currentPage <= 1
                ? "pointer-events-none opacity-40 text-gray-400 border-gray-200"
                : "text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            ← Previous
          </Link>
          <span className="text-gray-500">
            Page {currentPage} of {totalPages}
          </span>
          <Link
            href={`/blog?page=${Math.min(totalPages, currentPage + 1)}${category ? `&category=${category}` : ""}`}
            className={`px-3 py-1.5 rounded border ${
              currentPage >= totalPages
                ? "pointer-events-none opacity-40 text-gray-400 border-gray-200"
                : "text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            Next →
          </Link>
        </div>
      )}
    </main>
  );
}
