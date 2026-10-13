import Link from "next/link";
import { ArrowRight, Bot, Download, Figma, MonitorSmartphone, Package, Plug, QrCode, Search, Smartphone, Sparkles } from "lucide-react";
import type { CategoryDto, PaginatedResponse, PublicProductListItemDto } from "@nexus/contracts";
import { EmptyState, ErrorState, SectionHeader } from "@nexus/ui";
import { ProductCard } from "./components/product-card";
import { ConsultForm } from "./components/consult-form";
import { listCategories, listPosts, listProducts, tryListProducts } from "./lib/server-api";
import { flattenCategories, findTopicCategory, navCategories, pickPrice, type HomeTopicKey } from "./lib/home-catalog";
import { formatDate, money, productTypeLabel } from "./lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Search, title: "Chọn sản phẩm phù hợp", text: "Xem demo, so sánh gói license theo số website và thời hạn cập nhật." },
  { icon: QrCode, title: "Thanh toán VietQR", text: "Quét mã bằng app ngân hàng. Đơn chỉ được xác nhận khi ngân hàng báo nhận đúng số tiền." },
  { icon: Download, title: "Tải file & nhận license", text: "File, mã bản quyền và hướng dẫn kích hoạt có sẵn trong trang tài khoản." },
];

type Topic = { key: HomeTopicKey; icon: typeof Plug; category: CategoryDto; products: PaginatedResponse<PublicProductListItemDto> };

const categoryHref = (slug: string) => `/products?category=${encodeURIComponent(slug)}`;

/** Product thumbnail, or a neutral branded placeholder when the catalog has no image. */
function ProductVisual({ product, className = "" }: { product: PublicProductListItemDto; className?: string }) {
  return product.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={product.thumbnailUrl} alt={product.name} loading="lazy" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-soft to-white ${className}`}>
      <Package aria-hidden className="h-12 w-12 text-brand/40" />
    </div>
  );
}

function PriceText({ product, className = "" }: { product: PublicProductListItemDto; className?: string }) {
  const p = pickPrice(product);
  return <span className={className}>{p ? money(p.amount, p.currency) : "Liên hệ"}</span>;
}

function TopicColumn({ topic, withCover = false }: { topic: Topic; withCover?: boolean }) {
  const { category, products, icon: Icon } = topic;
  // Cover = newest product image in the group (categories have no image field).
  const coverProduct = withCover ? products.items.find((p) => p.thumbnailUrl) : undefined;
  return (
    <article aria-labelledby={`topic-${category.slug}`} className="card flex flex-col overflow-hidden">
      {coverProduct && (
        <div className="relative aspect-[16/8] overflow-hidden bg-brand-soft">
          <ProductVisual product={coverProduct} />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-brand shadow-card">
            <Icon aria-hidden className="h-3.5 w-3.5" />
            {category.name}
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
      <div className="flex items-start gap-4">
        {!coverProduct && (
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div>
          <h3 id={`topic-${category.slug}`} className="text-lg font-bold text-ink">
            {category.name}
          </h3>
          {category.description && <p className="mt-1 text-sm leading-6 text-body">{category.description}</p>}
        </div>
      </div>
      {products.items.length > 0 ? (
        <ul className="mt-4 flex-1 divide-y divide-line">
          {products.items.map((p) => (
            <li key={p.id}>
              <Link href={`/products/${p.slug}`} className="flex items-center justify-between gap-4 py-3 text-sm hover:text-brand">
                <span className="line-clamp-1 font-medium text-ink">{p.name}</span>
                <PriceText product={p} className="shrink-0 font-semibold text-ink" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 flex-1 text-sm text-muted">Danh mục đang cập nhật sản phẩm.</p>
      )}
      <Link href={categoryHref(category.slug)} className="link mt-4 inline-flex items-center gap-1.5 text-sm">
        Xem tất cả {products.total > 0 ? `${products.total} sản phẩm` : category.name}
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
      </div>
    </article>
  );
}

export default async function HomePage() {
  const [latestResult, tree, posts] = await Promise.all([
    tryListProducts({ limit: "10", sort: "newest", currency: "VND" }),
    listCategories(),
    listPosts({ limit: "3" }),
  ]);
  const nav = navCategories(tree);
  const flat = flattenCategories(tree);

  const topicDefs: { key: HomeTopicKey; icon: typeof Plug }[] = [
    { key: "wordpress", icon: MonitorSmartphone },
    { key: "plugins", icon: Plug },
    { key: "uiKits", icon: Figma },
    { key: "webApp", icon: MonitorSmartphone },
    { key: "mobileApp", icon: Smartphone },
    { key: "chatbot", icon: Bot },
  ];
  const resolved = topicDefs
    .map((d) => ({ ...d, category: findTopicCategory(flat, d.key) }))
    .filter((d): d is { key: HomeTopicKey; icon: typeof Plug; category: CategoryDto } => !!d.category);
  const topicProducts = await Promise.all(
    resolved.map((d) => listProducts({ category: d.category.slug, limit: "4", sort: "newest", currency: "VND" })),
  );
  const topics: Topic[] = resolved.map((d, i) => ({ ...d, products: topicProducts[i] }));
  const byKey = (k: HomeTopicKey) => topics.find((t) => t.key === k);
  const wordpress = byKey("wordpress");
  const pluginsAndKits = [byKey("plugins"), byKey("uiKits")].filter((t): t is Topic => !!t);
  const solutions = [byKey("webApp"), byKey("mobileApp"), byKey("chatbot")].filter((t): t is Topic => !!t);

  const latest = latestResult.data;
  const catalogDown = !latestResult.ok;
  const [featured, ...rest] = latest.items;
  const topPicks = rest.slice(0, 4);
  const grid = latest.items.slice(0, 6);

  return (
    <>
      {/* R2 · Hero — centred headline + search (no 50/50 split) */}
      <section aria-labelledby="hero-heading" className="border-b border-line bg-surface">
        <div className="container-site flex flex-col items-center py-14 text-center md:py-20">
          <p className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-brand">
            <Sparkles aria-hidden className="h-4 w-4" />
            Theme · Plugin · Web app · Mobile app · Chatbot AI
          </p>
          <h1 id="hero-heading" className="mt-6 max-w-4xl text-[32px] font-extrabold leading-[1.15] tracking-tight text-ink [text-wrap:balance] sm:text-5xl lg:text-[56px]">
            Khởi tạo website chuyên nghiệp <span className="text-brand">với giao diện &amp; giải pháp số</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-body sm:text-lg">
            Theme WordPress, plugin, UI kit, web app, mobile app và chatbot AI được tuyển chọn — thanh toán VietQR, nhận mã nguồn và
            license ngay khi ngân hàng xác nhận.
          </p>

          <form action="/products" role="search" className="mt-8 w-full max-w-3xl">
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2 shadow-lift sm:flex-row sm:items-center">
              <label htmlFor="hero-search" className="sr-only">
                Tìm sản phẩm
              </label>
              <div className="relative flex-1">
                <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                <input
                  id="hero-search"
                  name="search"
                  type="search"
                  placeholder="Tìm theme, plugin, web app, chatbot AI…"
                  className="min-h-[48px] w-full rounded-xl bg-transparent pl-11 pr-3 text-base text-ink placeholder:text-muted/80 focus:outline-none"
                />
              </div>
              {nav.length > 0 && (
                <>
                  <label htmlFor="hero-category" className="sr-only">
                    Danh mục
                  </label>
                  <select
                    id="hero-category"
                    name="category"
                    defaultValue=""
                    className="min-h-[48px] rounded-xl border border-line bg-surface px-3 text-sm text-ink sm:w-48 sm:border-0 sm:border-l sm:rounded-none"
                  >
                    <option value="">Tất cả danh mục</option>
                    {nav.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button type="submit" className="btn-primary min-h-[48px] px-6">
                Tìm kiếm
              </button>
            </div>
          </form>

          {nav.length > 0 && (
            <div className="mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-2">
              <span className="text-sm text-muted">Phổ biến:</span>
              {nav.slice(0, 5).map((c) => (
                <Link
                  key={c.slug}
                  href={categoryHref(c.slug)}
                  className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-body transition-colors hover:border-brand/40 hover:text-brand"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* R2b · Showcase — newest release + top picks (the API has no "featured" flag) */}
        {featured && (
          <div className="container-site grid gap-6 pb-16 lg:grid-cols-[1.5fr_1fr]">
            <Link href={`/products/${featured.slug}`} className="group card flex flex-col gap-5 bg-canvas p-6 transition-shadow hover:shadow-lift sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="inline-flex rounded-full border border-warning/40 px-2.5 py-0.5 text-xs font-semibold text-warning">Mới phát hành</span>
                  <h2 className="mt-3 text-xl font-bold leading-snug text-ink group-hover:text-brand sm:text-2xl">{featured.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {[featured.categories[0]?.name, productTypeLabel(featured.productType)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <PriceText product={featured} className="text-2xl font-extrabold text-ink" />
              </div>
              <div className="aspect-[16/7] overflow-hidden rounded-xl">
                <ProductVisual product={featured} className="transition-transform duration-300 group-hover:scale-[1.02]" />
              </div>
              <span className="btn-primary self-end">Xem chi tiết</span>
            </Link>

            <div className="card p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink">Vừa cập nhật</h2>
                <Link href="/products?sort=newest" className="link text-sm">
                  Xem tất cả
                </Link>
              </div>
              {topPicks.length > 0 ? (
                <ul className="mt-2 divide-y divide-line">
                  {topPicks.map((p) => (
                    <li key={p.id}>
                      <Link href={`/products/${p.slug}`} className="flex items-center gap-4 py-3.5 hover:text-brand">
                        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                          <ProductVisual product={p} />
                        </span>
                        <span className="min-w-0 flex-1">
                          {p.categories[0] && <span className="eyebrow block text-[11px]">{p.categories[0].name}</span>}
                          <span className="line-clamp-2 text-sm font-semibold text-ink">{p.name}</span>
                        </span>
                        <PriceText product={p} className="shrink-0 text-sm font-bold text-ink" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted">Chưa có thêm sản phẩm mới.</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* R3–R4 · Category tabs + newest grid */}
      <section aria-labelledby="latest-heading" className="container-site space-y-6 py-16 md:py-20">
        <SectionHeader
          id="latest-heading"
          eyebrow="Kiểm duyệt chất lượng mã nguồn"
          title="Sản phẩm mới tuyển chọn"
          description="Mã nguồn được kiểm tra trước khi lên kệ, cập nhật theo gói đã mua."
          action={
            <Link href="/products" className="link inline-flex items-center gap-1 text-sm">
              Xem tất cả <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          }
        />
        {nav.length > 0 && (
          <nav aria-label="Danh mục sản phẩm" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
              <li>
                <Link href="/products" aria-current="page" className="inline-flex min-h-[40px] items-center rounded-full bg-brand px-4 text-sm font-medium text-white">
                  Tất cả
                </Link>
              </li>
              {nav.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={categoryHref(c.slug)}
                    className="inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full border border-line bg-surface px-4 text-sm font-medium text-body hover:border-brand/40 hover:text-brand"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {catalogDown ? (
          <ErrorState
            title="Chưa tải được danh sách sản phẩm"
            description="Máy chủ cửa hàng đang không phản hồi. Vui lòng thử lại sau ít phút."
            action={
              <a href="/" className="btn-ghost">
                Thử lại
              </a>
            }
          />
        ) : grid.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3">
            {grid.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Cửa hàng đang cập nhật sản phẩm"
            description="Vui lòng quay lại sau ít phút."
          />
        )}
      </section>

      {/* R5 · WordPress themes by need */}
      {wordpress && (
        <section aria-labelledby="wp-heading" className="bg-brand-soft">
          <div className="container-site space-y-7 py-16 md:py-20">
            <SectionHeader
              id="wp-heading"
              align="center"
              eyebrow="Bộ sưu tập theme WordPress"
              title="Chọn theme phù hợp với website của bạn"
              description="Lọc theo nhu cầu để xem các mẫu phù hợp."
            />
            {wordpress.category.children && wordpress.category.children.length > 0 && (
              <ul className="flex flex-wrap justify-center gap-2">
                {wordpress.category.children.map((c) => (
                  <li key={c.slug}>
                    <Link href={categoryHref(c.slug)} className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-body hover:border-brand/40 hover:text-brand">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {wordpress.products.items.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {wordpress.products.items.map((p) => (
                  <Link key={p.id} href={`/products/${p.slug}`} className="group relative block aspect-[16/9] overflow-hidden rounded-2xl bg-navy">
                    <ProductVisual product={p} className="transition-transform duration-300 group-hover:scale-[1.03]" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent p-5 pt-16">
                      <span className="block text-base font-bold uppercase tracking-wide text-white">{p.name}</span>
                      <PriceText product={p} className="mt-1 block text-sm text-white/80" />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title={`${wordpress.category.name} đang được cập nhật`} description="Các mẫu theme sẽ xuất hiện tại đây." />
            )}
            <div className="text-center">
              <Link href={categoryHref(wordpress.category.slug)} className="link inline-flex items-center gap-1.5">
                Xem toàn bộ{wordpress.products.total > 0 ? ` ${wordpress.products.total}` : ""} sản phẩm {wordpress.category.name}
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* R6 · Plugins & UI kits — two columns side by side */}
      {pluginsAndKits.length > 0 && (
        <section aria-labelledby="tools-heading" className="container-site space-y-7 py-16 md:py-20">
          <SectionHeader
            id="tools-heading"
            eyebrow="Công cụ mở rộng & thiết kế"
            title="Khám phá Plugins & UI Kits"
            description="Mở rộng tính năng cho website và tăng tốc khâu thiết kế."
          />
          <div className={`grid gap-6 ${pluginsAndKits.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {pluginsAndKits.map((t) => (
              <TopicColumn key={t.key} topic={t} />
            ))}
          </div>
        </section>
      )}

      {/* R6b · Web app, mobile app, chatbot AI — three columns */}
      {solutions.length > 0 && (
        <section aria-labelledby="solutions-heading" className="border-y border-line bg-surface">
          <div className="container-site space-y-7 py-16 md:py-20">
            <SectionHeader
              id="solutions-heading"
              eyebrow="Giải pháp số đóng gói sẵn"
              title="Web App · Mobile App · Chatbot AI"
              description="Mã nguồn hoàn chỉnh kèm license — triển khai nhanh cho doanh nghiệp và agency."
              action={
                <Link href="/products" className="link inline-flex items-center gap-1 text-sm">
                  Xem tất cả giải pháp <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              }
            />
            <div className={`grid gap-6 md:grid-cols-2 ${solutions.length > 2 ? "lg:grid-cols-3" : ""}`}>
              {solutions.map((t) => (
                <TopicColumn key={t.key} topic={t} withCover />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* R7 · How buying works */}
      <section aria-labelledby="steps-heading" className="container-site space-y-8 py-16 md:py-20">
        <SectionHeader id="steps-heading" align="center" eyebrow="Mua nhanh · nhận hàng tự động" title="Quy trình mua và sử dụng đơn giản" />
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card relative p-6">
              {/* #8794AB: lightest grey that still meets 3:1 for large text on white (Figma uses a lighter tint). */}
              <span aria-hidden className="absolute right-5 top-4 text-4xl font-extrabold text-[#8794AB]">
                0{i + 1}
              </span>
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <s.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-body">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* R8 · Consultation form — navy band, placed right before News */}
      <section aria-labelledby="consult-heading" className="bg-navy">
        <div className="container-site flex flex-col items-center py-16 text-center md:py-20">
          <p className="eyebrow text-[#93B4FF]">Tư vấn miễn phí</p>
          <h2 id="consult-heading" className="mt-3 text-[28px] font-bold text-white sm:text-[34px]">
            Chưa biết chọn theme nào?
          </h2>
          <p className="mt-3 max-w-xl text-base leading-7 text-white/75">
            Để lại nhu cầu, đội ngũ kỹ thuật sẽ gợi ý theme, app hoặc chatbot và gói license phù hợp với website của bạn.
          </p>
          <div className="mt-8 w-full max-w-3xl">
            <ConsultForm />
          </div>
        </div>
      </section>

      {/* R9 · News */}
      {posts.items.length > 0 && (
        <section aria-labelledby="news-heading" className="container-site space-y-7 pt-16 md:pt-20">
          <SectionHeader
            id="news-heading"
            eyebrow="Kỹ thuật & xu hướng"
            title="Tin tức & kiến thức"
            action={
              <Link href="/blog" className="link inline-flex items-center gap-1 text-sm">
                Xem tất cả bài viết <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            }
          />
          <div className="grid gap-6 md:grid-cols-3">
            {posts.items.map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`} className="group card flex flex-col overflow-hidden transition-shadow hover:shadow-lift">
                <span className="aspect-[16/9] overflow-hidden bg-brand-soft">
                  {post.featuredImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.featuredImageUrl} alt={post.featuredImageAlt || ""} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <span className="flex h-full items-center justify-center">
                      <Sparkles aria-hidden className="h-10 w-10 text-brand/30" />
                    </span>
                  )}
                </span>
                <span className="flex flex-1 flex-col gap-2 p-5">
                  <span className="flex items-center gap-3 text-xs">
                    {post.category && <span className="eyebrow">{post.category.name}</span>}
                    <span className="text-muted">{formatDate(post.publishedAt)}</span>
                  </span>
                  <span className="line-clamp-2 text-lg font-bold leading-snug text-ink group-hover:text-brand">{post.title}</span>
                  <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-brand">
                    Đọc bài viết <ArrowRight aria-hidden className="h-4 w-4" />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
