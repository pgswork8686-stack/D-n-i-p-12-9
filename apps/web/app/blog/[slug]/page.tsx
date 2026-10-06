import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import {
  safeJsonLd,
  resolvePublicSiteUrl,
  buildArticleMetadata,
  buildArticleJsonLd,
} from "@nexus/utils";
import { fetchArticleBySlug } from "../../lib/storefront-fetch";
import { formatDate } from "../../lib/format";

export const dynamic = "force-dynamic";

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await fetchArticleBySlug(slug);
  const siteUrl = resolvePublicSiteUrl();
  const meta = buildArticleMetadata({ post, siteUrl }) as Metadata;
  // The shared builder already appends the brand; bypass the layout template.
  return { ...meta, title: meta.title ? { absolute: String(meta.title) } : undefined };
}

export default async function ArticleDetailPage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const post = await fetchArticleBySlug(slug);

  if (!post) {
    notFound();
  }

  const siteUrl = resolvePublicSiteUrl();
  const jsonLd = buildArticleJsonLd({ post, siteUrl });

  return (
    <article className="container-site py-10 md:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      <div className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Link href="/blog" className="hover:text-brand">
            Blog
          </Link>
          {post.category && (
            <>
              <ChevronRight aria-hidden className="h-4 w-4" />
              <Link href={`/blog/category/${post.category.slug}`} className="hover:text-brand">
                {post.category.name}
              </Link>
            </>
          )}
        </nav>

        <header className="mt-6">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl md:text-5xl">{post.title}</h1>
          {post.excerpt && <p className="mt-5 text-lg leading-8 text-muted">{post.excerpt}</p>}
          <p className="mt-6 text-sm text-muted">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            {post.readingTimeMinutes ? ` · ${post.readingTimeMinutes} phút đọc` : ""}
            {post.author?.profile?.displayName ? ` · ${post.author.profile.displayName}` : ""}
          </p>
        </header>

        {post.featuredImageUrl && (
          <figure className="mt-8 overflow-hidden rounded-2xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.featuredImageUrl} alt={post.featuredImageAlt || post.title} className="max-h-[480px] w-full object-cover" />
            {post.featuredImageAlt && <figcaption className="p-3 text-center text-xs text-muted">{post.featuredImageAlt}</figcaption>}
          </figure>
        )}

        {/* Content is sanitized by the backend (sanitize-html allowlist). */}
        <div className="prose-article mt-10" dangerouslySetInnerHTML={{ __html: post.content }} />

        <footer className="mt-16 flex flex-col gap-3 border-t border-line pt-8 sm:flex-row sm:justify-between">
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
            <ArrowLeft aria-hidden className="h-4 w-4" /> Tất cả bài viết
          </Link>
          <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand">
            Khám phá sản phẩm <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </footer>
      </div>
    </article>
  );
}
