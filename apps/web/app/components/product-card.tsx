import Link from "next/link";
import { Package } from "lucide-react";
import type { PublicProductListItemDto } from "@nexus/contracts";
import { money, productTypeLabel } from "../lib/format";
import { pickPrice } from "../lib/home-catalog";

/**
 * Figma "Product Card": image, group label, title, description, price + CTA.
 * In the 2-column mobile grid (~170px wide) the description is hidden and the
 * CTA spans the card so name, price, thumbnail and CTA all stay readable.
 */
export function ProductCard({ product }: { product: PublicProductListItemDto }) {
  const price = pickPrice(product);
  const group = product.categories[0]?.name ?? productTypeLabel(product.productType);

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group card flex h-full flex-col overflow-hidden transition-[box-shadow,border-color] duration-200 hover:border-brand/40 hover:shadow-lift"
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
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5 sm:gap-2 sm:p-5">
        <span className="eyebrow line-clamp-1 text-[11px]">{group}</span>
        <h3 className="line-clamp-2 text-sm font-bold leading-snug text-ink group-hover:text-brand sm:text-base">{product.name}</h3>
        {product.shortDescription && (
          <p className="hidden text-sm leading-6 text-body sm:line-clamp-2">{product.shortDescription}</p>
        )}
        <div className="mt-auto flex flex-col gap-2.5 pt-2 sm:flex-row sm:items-center sm:justify-between sm:pt-3">
          <span className="text-base font-bold text-ink sm:text-lg">
            {price ? (
              <>
                <span className="sr-only">Giá từ </span>
                {money(price.amount, price.currency)}
              </>
            ) : (
              "Liên hệ"
            )}
          </span>
          <span aria-hidden className="btn-primary btn-sm w-full sm:w-auto">
            Xem chi tiết
          </span>
        </div>
      </div>
    </Link>
  );
}
