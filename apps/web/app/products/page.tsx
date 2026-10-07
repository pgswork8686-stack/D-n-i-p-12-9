import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { ProductCard } from "../components/product-card";
import { listCategories, listProducts } from "../lib/server-api";
import { PRODUCT_TYPE_LABELS } from "../lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sản phẩm",
  description: "Theme, plugin, Figma UI kit và license phần mềm — lọc theo danh mục, loại sản phẩm và giá.",
};

const SORTS = [
  { value: "newest", label: "Mới nhất" },
  { value: "price_asc", label: "Giá tăng dần" },
  { value: "price_desc", label: "Giá giảm dần" },
  { value: "name_asc", label: "Tên A → Z" },
];

const LISTED_TYPES = ["DOWNLOADABLE_ASSET", "LICENSED_SOFTWARE", "EXTERNAL_MANAGED_LICENSE", "SERVICE"];

interface Props {
  searchParams: { search?: string; category?: string; productType?: string; sort?: string; page?: string };
}

export default async function ProductsPage({ searchParams }: Props) {
  const page = Math.max(1, Number.parseInt(searchParams.page || "1", 10) || 1);
  const sort = SORTS.some((s) => s.value === searchParams.sort) ? searchParams.sort! : "newest";
  const productType = LISTED_TYPES.includes(searchParams.productType || "") ? searchParams.productType : undefined;

  const [result, categories] = await Promise.all([
    listProducts({
      page: String(page),
      limit: "12",
      sort,
      currency: "VND",
      search: searchParams.search?.trim() || undefined,
      category: searchParams.category || undefined,
      productType,
    }),
    listCategories(),
  ]);

  const hrefFor = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, page: String(p) })) if (v) qs.set(k, v);
    return `/products?${qs.toString()}`;
  };
  const activeCategory = categories.find((c) => c.slug === searchParams.category);
  const hasFilters = Boolean(searchParams.search || searchParams.category || productType);

  return (
    <div className="container-site py-10 md:py-14">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {activeCategory?.name || (productType ? PRODUCT_TYPE_LABELS[productType] : "Tất cả sản phẩm")}
        </h1>
        <p className="mt-3 text-muted">
          {searchParams.search ? (
            <>
              Kết quả cho “<span className="font-medium text-ink">{searchParams.search}</span>” — {result.total} sản phẩm
            </>
          ) : (
            `${result.total} sản phẩm, giá hiển thị bằng VND.`
          )}
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Filters: plain GET form — works without JavaScript */}
        <aside aria-label="Bộ lọc">
          <form method="get" action="/products" className="card space-y-5 p-5 lg:sticky lg:top-24">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <SlidersHorizontal aria-hidden className="h-4 w-4" /> Bộ lọc
            </p>
            <div>
              <label htmlFor="f-search" className="field-label">
                Từ khoá
              </label>
              <input id="f-search" name="search" type="search" defaultValue={searchParams.search} className="field-input" />
            </div>
            <div>
              <label htmlFor="f-category" className="field-label">
                Danh mục
              </label>
              <select id="f-category" name="category" defaultValue={searchParams.category || ""} className="field-input">
                <option value="">Tất cả danh mục</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.parentId ? `— ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-type" className="field-label">
                Loại sản phẩm
              </label>
              <select id="f-type" name="productType" defaultValue={productType || ""} className="field-input">
                <option value="">Tất cả loại</option>
                {LISTED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PRODUCT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-sort" className="field-label">
                Sắp xếp
              </label>
              <select id="f-sort" name="sort" defaultValue={sort} className="field-input">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1">
                Áp dụng
              </button>
              {hasFilters && (
                <Link href="/products" className="btn-ghost">
                  Xoá lọc
                </Link>
              )}
            </div>
          </form>
        </aside>

        <section aria-label="Danh sách sản phẩm">
          {result.items.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-lg font-semibold text-ink">Không tìm thấy sản phẩm phù hợp</p>
              <p className="mt-2 text-muted">Thử từ khoá khác hoặc bỏ bớt bộ lọc.</p>
              <Link href="/products" className="btn-ghost mt-6">
                Xem tất cả sản phẩm
              </Link>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {result.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}

          {result.totalPages > 1 && (
            <nav aria-label="Phân trang" className="mt-10 flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={hrefFor(page - 1)} className="btn-ghost" rel="prev">
                  <ChevronLeft aria-hidden className="h-4 w-4" /> Trước
                </Link>
              ) : null}
              <span className="px-3 text-sm text-muted">
                Trang {page}/{result.totalPages}
              </span>
              {page < result.totalPages ? (
                <Link href={hrefFor(page + 1)} className="btn-ghost" rel="next">
                  Sau <ChevronRight aria-hidden className="h-4 w-4" />
                </Link>
              ) : null}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
