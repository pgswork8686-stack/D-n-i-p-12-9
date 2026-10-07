import type { Metadata } from "next";
import Link from "next/link";
import { resolvePublicSiteUrl } from "@nexus/utils";
import type { ContentCategoryDto, PaginatedResponse, PublicContentListItemDto } from "@nexus/contracts";
import { serverApiUrl } from "../lib/server-api";
import { Pager, PostGrid } from "../components/post-grid";

export const dynamic = "force-dynamic";

const TITLE = "Blog & hướng dẫn";
const DESCRIPTION = "Hướng dẫn dựng website, tối ưu theme/plugin WordPress, thiết kế UI và kinh nghiệm vận hành.";

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = resolvePublicSiteUrl();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${siteUrl}/blog` },
    openGraph: { title: `${TITLE} | NexusTheme`, description: DESCRIPTION, url: `${siteUrl}/blog`, siteName: "NexusTheme", type: "website" },
    twitter: { card: "summary_large_image", title: `${TITLE} | NexusTheme`, description: DESCRIPTION },
  };
}

interface BlogPageProps {
  searchParams: Promise<{ category?: string; page?: string }>;
}

async function getBlogData(categorySlug?: string, page: number = 1) {
  const apiUrl = serverApiUrl();
  const params = new URLSearchParams();
  if (categorySlug) params.set("categorySlug", categorySlug);
  params.set("page", page.toString());
  params.set("limit", "12");

  try {
    const [postsRes, catsRes] = await Promise.all([
      fetch(`${apiUrl}/v1/content/posts?${params.toString()}`, { cache: "no-store" }),
      fetch(`${apiUrl}/v1/content/categories`, { cache: "no-store" }),
    ]);
    const postsData: Partial<PaginatedResponse<PublicContentListItemDto>> = postsRes.ok ? await postsRes.json() : {};
    const categories: ContentCategoryDto[] = catsRes.ok ? await catsRes.json() : [];
    return {
      posts: postsData.items || [],
      totalPages: postsData.totalPages || 1,
      categories: Array.isArray(categories) ? categories : [],
    };
  } catch {
    return { posts: [], totalPages: 1, categories: [] as ContentCategoryDto[] };
  }
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { category, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const { posts, categories, totalPages } = await getBlogData(category, currentPage);

  return (
    <div className="container-site py-10 md:py-14">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{TITLE}</h1>
        <p className="mt-3 text-lg text-muted">{DESCRIPTION}</p>
      </header>

      {categories.length > 0 && (
        <nav aria-label="Chuyên mục" className="mt-8 flex flex-wrap gap-2">
          <Link
            href="/blog"
            aria-current={!category ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              !category ? "bg-brand text-white" : "border border-line bg-surface text-muted hover:text-brand"
            }`}
          >
            Tất cả
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/blog/category/${c.slug}`}
              className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand"
            >
              {c.name}
              {typeof c.postCount === "number" ? ` (${c.postCount})` : ""}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-10">
        <PostGrid posts={posts} />
        <Pager
          page={currentPage}
          totalPages={totalPages}
          hrefFor={(p) => `/blog?${new URLSearchParams({ ...(category ? { category } : {}), page: String(p) }).toString()}`}
        />
      </div>
    </div>
  );
}
