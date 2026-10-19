import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fetchPageBySlug } from "../../lib/storefront-fetch";
import { findPolicyPage } from "../../lib/policy-pages";
import { formatDate } from "../../lib/format";

export const dynamic = "force-dynamic";

interface PolicyPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PolicyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const policy = findPolicyPage(slug);
  if (!policy) return { title: "Không tìm thấy trang", robots: { index: false } };
  const page = await fetchPageBySlug(slug).catch(() => null);
  if (!page) return { title: policy.title, robots: { index: false } };
  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription || page.excerpt || undefined,
  };
}

export default async function PolicyDetailPage({ params }: PolicyPageProps) {
  const { slug } = await params;
  // Only the six approved policy slugs are routable; everything else is a plain 404.
  if (!findPolicyPage(slug)) notFound();
  const page = await fetchPageBySlug(slug);
  // Not published (or not created yet): the page does not exist publicly.
  if (!page) notFound();

  return (
    <article className="container-site py-10 md:py-14">
      <div className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Link href="/chinh-sach" className="hover:text-brand">Chính sách</Link>
          <ChevronRight aria-hidden className="h-4 w-4" />
          <span aria-current="page">{page.title}</span>
        </nav>

        <header className="mt-6">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">{page.title}</h1>
          {page.excerpt && <p className="mt-4 text-lg leading-8 text-muted">{page.excerpt}</p>}
          {(page.updatedAt || page.publishedAt) && (
            <p className="mt-4 text-sm text-muted">
              Cập nhật lần cuối: <time dateTime={page.updatedAt || page.publishedAt}>{formatDate(page.updatedAt || page.publishedAt)}</time>
            </p>
          )}
        </header>

        {/* Content is sanitized by the backend (sanitize-html allowlist). */}
        <div className="prose-article mt-10" dangerouslySetInnerHTML={{ __html: page.content }} />
      </div>
    </article>
  );
}
