import Link from "next/link";
import { Package } from "lucide-react";
import type { PublicProductListItemDto } from "@nexus/contracts";
import { money, productTypeLabel, DEFAULT_CURRENCY } from "../lib/format";

export function ProductCard({ product }: { product: PublicProductListItemDto }) {
  const price =
    product.minPricesByCurrency?.[DEFAULT_CURRENCY] ??
    (product.minPrice?.currency === DEFAULT_CURRENCY ? product.minPrice.amount : undefined);
  const fallbackPrice = price === undefined && product.minPrice ? product.minPrice : null;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group card flex h-full flex-col overflow-hidden transition-shadow duration-200 hover:shadow-lift"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-brand-soft">
        {product.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnailUrl}
            alt={product.name}
            loading="lazy"
            width={480}
            height={360}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package aria-hidden className="h-12 w-12 text-brand/40" />
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-surface/95 px-2.5 py-1 text-xs font-medium text-ink shadow-sm">
          {productTypeLabel(product.productType)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        {product.brand && <span className="text-xs font-medium uppercase tracking-wide text-muted">{product.brand}</span>}
        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-ink group-hover:text-brand">
          {product.name}
        </h3>
        {product.shortDescription && (
          <p className="line-clamp-2 text-sm leading-6 text-muted">{product.shortDescription}</p>
        )}
        <div className="mt-auto pt-3">
          <span className="text-xs text-muted">Từ </span>
          <span className="text-lg font-bold text-ink">
            {price !== undefined
              ? money(price, DEFAULT_CURRENCY)
              : fallbackPrice
                ? money(fallbackPrice.amount, fallbackPrice.currency)
                : "Liên hệ"}
          </span>
        </div>
      </div>
    </Link>
  );
}
