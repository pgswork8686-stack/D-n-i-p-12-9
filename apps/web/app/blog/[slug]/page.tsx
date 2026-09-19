import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@nexus/ui";
import {
  safeJsonLd,
  resolvePublicSiteUrl,
  resolveApiUrl,
  buildArticleMetadata,
  buildArticleJsonLd,
} from "@nexus/utils";

export const dynamic = "force-dynamic";

import { fetchArticleBySlug } from "../../lib/storefront-fetch";

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

async function getArticle(slug: string) {
  return fetchArticleBySlug(slug);
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  let post = null;
  try {
    post = await getArticle(slug);
  } catch (err) {
    throw err;
  }

  const siteUrl = resolvePublicSiteUrl();
  return buildArticleMetadata({ post, siteUrl }) as Metadata;
}

export default async function ArticleDetailPage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const post = await getArticle(slug);

  if (!post) {
    notFound();
  }

  const siteUrl = resolvePublicSiteUrl();
  const jsonLd = buildArticleJsonLd({ post, siteUrl });

  return (
    <article className="max-w-4xl mx-auto py-12 px-6 font-sans">
      {/* Safe JSON-LD script injection */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      {/* Breadcrumb Navigation */}
      <nav className="text-xs text-gray-500 mb-8 flex items-center gap-2">
        <Link href="/" className="hover:text-gray-900">
          Home
        </Link>
        <span>/</span>
        <Link href="/blog" className="hover:text-gray-900">
          Blog
        </Link>
        {post.category && (
          <>
            <span>/</span>
            <Link
              href={`/blog/category/${post.category.slug}`}
              className="hover:text-gray-900"
            >
              {post.category.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-gray-700 font-medium truncate max-w-xs">
          {post.title}
        </span>
      </nav>

      {/* Article Header */}
      <header className="mb-8 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          {post.category && (
            <Link href={`/blog/category/${post.category.slug}`}>
              <Badge variant="info">
                {post.category.name}
              </Badge>
            </Link>
          )}
          {post.readingTimeMinutes && (
            <span className="text-xs text-gray-400">
              {post.readingTimeMinutes} min read
            </span>
          )}
        </div>

        <h1 className="text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
          {post.title}
        </h1>

        {post.excerpt && (
          <p className="text-base md:text-lg text-gray-600 mt-4 leading-relaxed font-light">
            {post.excerpt}
          </p>
        )}

        <div className="flex items-center justify-between mt-6 text-xs text-gray-500">
          <div>
            Published on{" "}
            <time dateTime={post.publishedAt} className="font-semibold text-gray-700">
              {new Date(post.publishedAt).toLocaleDateString("vi-VN", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </div>
          {post.canonicalUrl && (
            <a
              href={post.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-gray-600 text-[11px]"
            >
              Original Source ↗
            </a>
          )}
        </div>
      </header>

      {/* Featured Image */}
      {post.featuredImageUrl && (
        <div className="mb-10 rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <img
            src={post.featuredImageUrl}
            alt={post.featuredImageAlt || post.title}
            className="w-full max-h-[480px] object-cover"
          />
          {post.featuredImageAlt && (
            <p className="text-[11px] text-gray-400 p-2 text-center italic">
              {post.featuredImageAlt}
            </p>
          )}
        </div>
      )}

      {/* Article Content Body (Sanitized on backend and safe) */}
      <div
        className="prose prose-slate max-w-none text-gray-800 leading-relaxed text-base md:text-lg space-y-4"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />

      {/* Footer Navigation */}
      <footer className="mt-16 pt-8 border-t border-gray-200 flex items-center justify-between">
        <Link
          href="/blog"
          className="text-sm font-semibold text-[#0037b0] hover:underline"
        >
          ← Back to All Articles
        </Link>
        <Link
          href="/products"
          className="text-sm font-semibold text-gray-600 hover:underline"
        >
          Explore Products →
        </Link>
      </footer>
    </article>
  );
}
