"use client";

import Link from "next/link";
import { AlertTriangle, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { money, productTypeLabel } from "../lib/format";

export default function CartPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { cart, isLoading, error, updateQuantity, removeItem } = useCart();

  if (authLoading || (user && !cart && isLoading)) {
    return (
      <div className="container-site flex justify-center py-24" role="status" aria-live="polite">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-brand" />
        <span className="sr-only">Đang tải giỏ hàng…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <EmptyState
        title="Đăng nhập để xem giỏ hàng"
        text="Giỏ hàng được lưu theo tài khoản để bạn tiếp tục trên mọi thiết bị."
        action={{ href: "/login?next=/cart", label: "Đăng nhập" }}
      />
    );
  }

  const items = cart?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="Giỏ hàng đang trống"
        text="Khám phá theme, plugin và UI kit để bắt đầu."
        action={{ href: "/products", label: "Xem sản phẩm" }}
      />
    );
  }

  const hasUnavailable = items.some((i) => !i.isAvailable);

  return (
    <div className="container-site py-10 md:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Giỏ hàng</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <ul className="space-y-4" aria-label="Sản phẩm trong giỏ">
          {items.map((item) => (
            <li key={item.id} className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{productTypeLabel(item.productType)}</p>
                <p className="mt-1 font-semibold text-ink">{item.productName}</p>
                <p className="text-sm text-muted">Gói: {item.variantName}</p>
                {!item.isAvailable && (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-danger">
                    <AlertTriangle aria-hidden className="h-4 w-4" />
                    {item.unavailableReason || "Sản phẩm không còn bán. Vui lòng xoá khỏi giỏ."}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-6 sm:justify-end">
                <div className="flex items-center rounded-xl border border-line" role="group" aria-label={`Số lượng ${item.productName}`}>
                  <button
                    type="button"
                    aria-label="Giảm số lượng"
                    disabled={isLoading || item.quantity <= 1}
                    onClick={() => void updateQuantity(item.id, item.quantity - 1).catch(() => {})}
                    className="inline-flex h-11 w-11 cursor-pointer items-center justify-center text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus aria-hidden className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center font-medium tabular-nums" aria-live="polite">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Tăng số lượng"
                    disabled={isLoading}
                    onClick={() => void updateQuantity(item.id, item.quantity + 1).catch(() => {})}
                    className="inline-flex h-11 w-11 cursor-pointer items-center justify-center text-ink disabled:opacity-40"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                  </button>
                </div>
                <p className="w-32 text-right font-bold tabular-nums text-ink">{money(item.lineTotalAmount, item.currency)}</p>
                <button
                  type="button"
                  aria-label={`Xoá ${item.productName}`}
                  disabled={isLoading}
                  onClick={() => void removeItem(item.id).catch(() => {})}
                  className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-red-50 hover:text-danger"
                >
                  <Trash2 aria-hidden className="h-5 w-5" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <aside className="card h-fit space-y-4 p-6 lg:sticky lg:top-24" aria-label="Tóm tắt đơn hàng">
          <h2 className="text-lg font-semibold text-ink">Tóm tắt</h2>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Tạm tính ({cart?.itemCount} sản phẩm)</span>
            <span className="font-medium tabular-nums">{money(cart!.subtotalAmount, cart!.currency)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-semibold text-ink">Tổng thanh toán</span>
            <span className="text-2xl font-extrabold tabular-nums text-ink">{money(cart!.totalAmount, cart!.currency)}</span>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {hasUnavailable ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Xoá các sản phẩm không còn bán để tiếp tục thanh toán.
            </p>
          ) : (
            <Link href="/checkout" className="btn-buy w-full text-base">
              Tiến hành thanh toán
            </Link>
          )}
          <Link href="/products" className="block text-center text-sm font-medium text-brand hover:underline">
            Tiếp tục mua sắm
          </Link>
        </aside>
      </div>
    </div>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action: { href: string; label: string } }) {
  return (
    <div className="container-site py-20">
      <div className="card mx-auto max-w-lg p-10 text-center">
        <ShoppingBag aria-hidden className="mx-auto h-12 w-12 text-brand/50" />
        <h1 className="mt-4 text-2xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-muted">{text}</p>
        <Link href={action.href} className="btn-primary mt-6">
          {action.label}
        </Link>
      </div>
    </div>
  );
}
