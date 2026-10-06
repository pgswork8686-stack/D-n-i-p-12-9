import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Download,
  KeyRound,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { ProductCard } from "./components/product-card";
import { listCategories, listPosts, listProducts } from "./lib/server-api";
import { formatDate } from "./lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: Search,
    title: "Chọn sản phẩm",
    text: "Xem demo, so sánh gói license theo số website và thời hạn cập nhật.",
  },
  {
    icon: QrCode,
    title: "Quét VietQR",
    text: "Chuyển khoản bằng app ngân hàng. Hệ thống tự đối soát, không cần gửi ảnh biên lai.",
  },
  {
    icon: Download,
    title: "Nhận hàng tự động",
    text: "File tải về, mã bản quyền và hướng dẫn kích hoạt có sẵn trong trang tài khoản.",
  },
];

const VALUES = [
  { icon: ShieldCheck, title: "Tải file an toàn", text: "Link tải ký số, hết hạn sau vài phút — không lộ file gốc." },
  { icon: KeyRound, title: "License theo tên miền", text: "Tự kích hoạt, chuyển website khi cần ngay trong tài khoản." },
  { icon: RefreshCw, title: "Cập nhật theo gói", text: "Nhận phiên bản mới trong thời hạn cập nhật của gói đã mua." },
  { icon: BadgeCheck, title: "Đối soát tự động", text: "Đơn chỉ được xác nhận khi ngân hàng báo đã nhận đúng số tiền." },
];

export default async function HomePage() {
  const [products, categories, posts] = await Promise.all([
    listProducts({ limit: "8", sort: "newest", currency: "VND" }),
    listCategories(),
    listPosts({ limit: "3" }),
  ]);
  const rootCategories = categories.filter((c) => !c.parentId).slice(0, 8);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_85%_-10%,rgb(79_70_229/0.12),transparent),radial-gradient(40rem_20rem_at_0%_110%,rgb(21_128_61/0.08),transparent)]"
        />
        <div className="container-site relative grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
              <QrCode aria-hidden className="h-4 w-4" />
              Thanh toán VietQR · Giao hàng tự động
            </p>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-ink [text-wrap:balance] sm:text-5xl lg:text-[3.25rem]">
              Theme, plugin &amp; license
              <span className="block text-brand">cho website của bạn.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
              Chọn sản phẩm, quét mã chuyển khoản và nhận file cùng mã bản quyền ngay khi ngân hàng xác nhận —
              không chờ duyệt thủ công.
            </p>

            <form action="/products" className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row" role="search">
              <label htmlFor="hero-search" className="sr-only">
                Tìm sản phẩm
              </label>
              <div className="relative flex-1">
                <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                <input
                  id="hero-search"
                  name="search"
                  type="search"
                  placeholder="Ví dụ: theme bán hàng, plugin SEO…"
                  className="field-input min-h-[52px] pl-11"
                />
              </div>
              <button type="submit" className="btn-primary min-h-[52px] px-6">
                Tìm kiếm
              </button>
            </form>

            {rootCategories.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {rootCategories.map((c) => (
                  <Link
                    key={c.id}
                    href={`/products?category=${c.slug}`}
                    className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm text-muted transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Visual: how an order resolves (illustrative, no fabricated data) */}
          <div aria-hidden className="relative mx-auto hidden w-full max-w-md lg:block">
            <div className="card rotate-[-2deg] p-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Thanh toán đơn hàng</span>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Chờ chuyển khoản</span>
              </div>
              <div className="mt-5 grid grid-cols-[112px_1fr] items-center gap-5">
                <div className="grid h-28 w-28 grid-cols-6 gap-0.5 rounded-xl border border-line bg-surface p-2">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <span key={i} className={`rounded-[2px] ${[0, 1, 2, 6, 8, 12, 13, 14, 3, 17, 21, 22, 24, 27, 29, 30, 31, 33, 35, 19, 10].includes(i) ? "bg-ink" : "bg-transparent"}`} />
                  ))}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="h-2.5 w-24 rounded bg-line" />
                  <div className="h-2.5 w-32 rounded bg-line" />
                  <div className="h-2.5 w-20 rounded bg-brand/30" />
                </div>
              </div>
            </div>
            <div className="card absolute -bottom-8 right-0 w-64 rotate-[3deg] p-4 sm:-right-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <BadgeCheck className="h-5 w-5 text-cta" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Đã nhận thanh toán</p>
                  <p className="text-xs text-muted">File &amp; license sẵn sàng</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured products */}
      <section className="container-site py-16 md:py-20" aria-labelledby="featured-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="featured-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Mới phát hành
            </h2>
            <p className="mt-2 text-muted">Sản phẩm vừa được cập nhật lên cửa hàng.</p>
          </div>
          <Link href="/products" className="hidden items-center gap-1 text-sm font-semibold text-brand hover:underline sm:inline-flex">
            Xem tất cả <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>

        {products.items.length > 0 ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="card mt-8 p-10 text-center text-muted">Cửa hàng đang cập nhật sản phẩm. Vui lòng quay lại sau.</p>
        )}
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-surface" aria-labelledby="steps-heading">
        <div className="container-site py-16 md:py-20">
          <h2 id="steps-heading" className="text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Mua trong 3 bước
          </h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card relative p-6">
                <span className="absolute right-5 top-5 text-4xl font-extrabold text-brand/10">0{i + 1}</span>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft">
                  <s.icon aria-hidden className="h-6 w-6 text-brand" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Values */}
      <section className="container-site py-16 md:py-20" aria-label="Cam kết">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((v) => (
            <div key={v.title} className="flex gap-4">
              <v.icon aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-cta" />
              <div>
                <h3 className="font-semibold text-ink">{v.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{v.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Blog */}
      {posts.items.length > 0 && (
        <section className="container-site pb-4" aria-labelledby="blog-heading">
          <div className="flex items-end justify-between">
            <h2 id="blog-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Hướng dẫn mới
            </h2>
            <Link href="/blog" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
              Xem blog <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {posts.items.map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`} className="card group p-6 transition-shadow hover:shadow-lift">
                {post.category && <span className="text-xs font-semibold uppercase tracking-wide text-brand">{post.category.name}</span>}
                <h3 className="mt-2 line-clamp-2 font-semibold leading-snug text-ink group-hover:text-brand">{post.title}</h3>
                {post.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{post.excerpt}</p>}
                <p className="mt-4 text-xs text-muted">{formatDate(post.publishedAt)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="container-site pt-16">
        <div className="relative overflow-hidden rounded-2xl bg-ink px-6 py-12 text-center sm:px-12">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Đã có tài khoản? Quản lý license và tải xuống tại một nơi.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/80">
            Kích hoạt tên miền, tải bản cập nhật và gửi yêu cầu hỗ trợ trong trang tài khoản.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/products" className="btn-buy px-6">
              Khám phá sản phẩm
            </Link>
            <a href={process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001"} className="btn border border-white/30 px-6 text-white hover:bg-white/10">
              Vào trang tài khoản
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
