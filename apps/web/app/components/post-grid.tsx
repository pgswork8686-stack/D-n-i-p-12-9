import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { PublicContentListItemDto } from "@nexus/contracts";
import { formatDate } from "../lib/format";

export function PostGrid({ posts }: { posts: PublicContentListItemDto[] }) {
  if (posts.length === 0) {
    return (
      <div className="card p-12 text-center">
        <FileText aria-hidden className="mx-auto h-10 w-10 text-brand/40" />
        <p className="mt-4 font-semibold text-ink">Chưa có bài viết</p>
        <p className="mt-1 text-muted">Nội dung mới sẽ sớm được cập nhật.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <Link key={post.id} href={`/blog/${post.slug}`} className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lift">
          <div className="aspect-[16/9] bg-brand-soft">
            {post.featuredImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.featuredImageUrl}
                alt={post.featuredImageAlt || post.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <FileText aria-hidden className="h-10 w-10 text-brand/30" />
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col p-5">
            {post.category && <span className="text-xs font-semibold uppercase tracking-wide text-brand">{post.category.name}</span>}
            <h2 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug text-ink group-hover:text-brand">{post.title}</h2>
            {post.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{post.excerpt}</p>}
            <p className="mt-auto pt-4 text-xs text-muted">
              {formatDate(post.publishedAt)}
              {post.readingTimeMinutes ? ` · ${post.readingTimeMinutes} phút đọc` : ""}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function Pager({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (p: number) => string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Phân trang" className="mt-10 flex items-center justify-center gap-2">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className="btn-ghost" rel="prev">
          <ChevronLeft aria-hidden className="h-4 w-4" /> Trước
        </Link>
      )}
      <span className="px-3 text-sm text-muted">
        Trang {page}/{totalPages}
      </span>
      {page < totalPages && (
        <Link href={hrefFor(page + 1)} className="btn-ghost" rel="next">
          Sau <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
      )}
    </nav>
  );
}
