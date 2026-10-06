import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { resolvePublicSiteUrl } from "@nexus/utils";
import { serverApiUrl } from "../../../lib/server-api";
import { Pager, PostGrid } from "../../../components/post-grid";

export const dynamic = "force-dynamic";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

async function getCategoryData(slug: string, page: number = 1) {
  const apiUrl = serverApiUrl();
  let catsRes: Response;
  let postsRes: Response;
  try {
    [catsRes, postsRes] = await Promise.all([
      fetch(`${apiUrl}/v1/content/categories`, { cache: "no-store" }),
      fetch(`${apiUrl}/v1/content/posts?categorySlug=${encodeURIComponent(slug)}&page=${page}&limit=12`, {
        cache: "no-store",
      }),
    ]);
  } catch {
    throw new Error("Unable to connect to content category service.");
  }

  if (!catsRes.ok || !postsRes.ok) {
    if (catsRes.status === 404) {
      return { category: null, posts: [], totalPages: 1 };
    }
    throw new Error(`Content category service error (${catsRes.status} / ${postsRes.status})`);
  }

  const categories = await catsRes.json();
  const currentCategory = Array.isArray(categories) ? categories.find((c: any) => c.slug === slug) : null;
  const postsData = await postsRes.json();

  return {
    category: currentCategory,
    posts: postsData.items || [],
    totalPages: postsData.totalPages || 1,
  };
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { category } = await getCategoryData(slug);

  if (!category) {
    return { title: "Không tìm thấy chuyên mục", robots: { index: false } };
  }

  const title = category.seoTitle || `${category.name} — bài viết & hướng dẫn`;
  const description =
    category.seoDescription || category.description || `Tất cả bài viết thuộc chuyên mục ${category.name} trên NexusTheme.`;
  const siteUrl = resolvePublicSiteUrl();

  return {
    title,
    description,
    alternates: { canonical: `${siteUrl}/blog/category/${category.slug}` },
    openGraph: { title: `${title} | NexusTheme`, description, url: `${siteUrl}/blog/category/${category.slug}`, siteName: "NexusTheme" },
  };
}

export default async function BlogCategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const { category, posts, totalPages } = await getCategoryData(slug, currentPage);

  if (!category) {
    notFound();
  }

  return (
    <div className="container-site py-10 md:py-14">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/blog" className="hover:text-brand">
          Blog
        </Link>
        <ChevronRight aria-hidden className="h-4 w-4" />
        <span className="text-ink">{category.name}</span>
      </nav>
      <header className="mt-4 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{category.name}</h1>
        {category.description && <p className="mt-3 text-lg text-muted">{category.description}</p>}
      </header>
      <div className="mt-10">
        <PostGrid posts={posts} />
        <Pager page={currentPage} totalPages={totalPages} hrefFor={(p) => `/blog/category/${category.slug}?page=${p}`} />
      </div>
    </div>
  );
}
