import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@nexus/ui";
import { resolvePublicSiteUrl, resolveApiUrl } from "@nexus/utils";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

async function getCategoryData(slug: string, page: number = 1) {
  const apiUrl = resolveApiUrl();
  try {
    const [catsRes, postsRes] = await Promise.all([
      fetch(`${apiUrl}/v1/content/categories`, { cache: "no-store" }),
      fetch(`${apiUrl}/v1/content/posts?categorySlug=${encodeURIComponent(slug)}&page=${page}&limit=12`, {
        cache: "no-store",
      }),
    ]);

    const categories = catsRes.ok ? await catsRes.json() : [];
    const currentCategory = Array.isArray(categories)
      ? categories.find((c: any) => c.slug === slug)
      : null;

    const postsData = postsRes.ok ? await postsRes.json() : { items: [], total: 0 };

    return {
      category: currentCategory,
      posts: postsData.items || [],
      total: postsData.total || 0,
      totalPages: postsData.totalPages || 1,
    };
  } catch {
    return {
      category: null,
      posts: [],
      total: 0,
      totalPages: 1,
    };
  }
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { category } = await getCategoryData(slug);

  if (!category) {
    return {
      title: "Category Not Found | NEXUSTHEME",
      description: "The requested category could not be found.",
    };
  }

  const title = category.seoTitle || `${category.name} Articles`;
  const description =
    category.seoDescription ||
    category.description ||
    `Browse all published articles and guides in ${category.name} on NEXUSTHEME.`;

  const siteUrl = resolvePublicSiteUrl();

  return {
    title: `${title} | NEXUSTHEME`,
    description,
    alternates: {
      canonical: `${siteUrl}/blog/category/${category.slug}`,
    },
    openGraph: {
      title: `${title} | NEXUSTHEME`,
      description,
      url: `${siteUrl}/blog/category/${category.slug}`,
      siteName: "NEXUSTHEME",
    },
  };
}

export default async function CategoryArchivePage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const { page } = await searchParams;
  const currentPage = Number(page) || 1;

  const { category, posts, total, totalPages } = await getCategoryData(slug, currentPage);

  if (!category) {
    notFound();
  }

  return (
    <main className="max-w-6xl mx-auto py-12 px-6 font-sans">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-500 mb-8 flex items-center gap-2">
        <Link href="/" className="hover:text-gray-900">
          Home
        </Link>
        <span>/</span>
        <Link href="/blog" className="hover:text-gray-900">
          Blog
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{category.name}</span>
      </nav>

      <div className="mb-10 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900">
            Category: {category.name}
          </h1>
          <Badge variant="info">{total} Articles</Badge>
        </div>
        {category.description && (
          <p className="text-sm md:text-base text-gray-500 max-w-2xl mt-2">
            {category.description}
          </p>
        )}
      </div>

      {posts.length === 0 ? (
        <div className="p-16 text-center bg-gray-50 rounded-2xl border border-gray-200 max-w-md mx-auto">
          <div className="text-4xl mb-3">📂</div>
          <h2 className="text-lg font-bold text-gray-800">No Articles in This Category</h2>
          <p className="text-xs text-gray-500 mt-1">Check back soon for content published here.</p>
          <Link href="/blog" className="inline-block mt-4 text-xs font-semibold text-[#0037b0] underline">
            ← View all articles
          </Link>
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
                    {post.readingTimeMinutes && (
                      <span className="text-gray-400">{post.readingTimeMinutes} min read</span>
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
            href={`/blog/category/${slug}?page=${Math.max(1, currentPage - 1)}`}
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
            href={`/blog/category/${slug}?page=${Math.min(totalPages, currentPage + 1)}`}
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
