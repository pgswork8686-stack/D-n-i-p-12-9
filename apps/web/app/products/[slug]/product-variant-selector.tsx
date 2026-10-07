"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldCheck, ShoppingBag } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { DEFAULT_CURRENCY, licenseSummary, money } from "../../lib/format";

interface ProductVariantSelectorProps {
  product: any;
}

function vndPrice(variant: any) {
  return variant?.prices?.find((p: any) => p.currency === DEFAULT_CURRENCY) ?? null;
}

export function ProductVariantSelector({ product }: ProductVariantSelectorProps) {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { addItem } = useCart();
  const purchasable = useMemo(
    () => (product.variants || []).filter((v: any) => vndPrice(v)?.amount > 0),
    [product.variants],
  );
  const [selectedId, setSelectedId] = useState<string>(purchasable[0]?.id || "");
  const [status, setStatus] = useState<"idle" | "adding" | "added">("idle");
  const [error, setError] = useState<string | null>(null);

  const selected = purchasable.find((v: any) => v.id === selectedId) || purchasable[0];
  const price = vndPrice(selected);

  const handleAdd = async (goToCart: boolean) => {
    setError(null);
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    if (!selected || !price) return;
    setStatus("adding");
    try {
      await addItem(selected.id, price.id);
      setStatus("added");
      if (goToCart) router.push("/cart");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Không thêm được vào giỏ hàng.");
    }
  };

  if (purchasable.length === 0) {
    return (
      <div className="card p-6">
        <p className="font-semibold text-ink">Sản phẩm chưa mở bán bằng VND</p>
        <p className="mt-2 text-sm text-muted">Vui lòng quay lại sau hoặc liên hệ hỗ trợ.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Chọn gói</legend>
        <div className="mt-3 space-y-3">
          {purchasable.map((v: any) => {
            const p = vndPrice(v);
            const isSelected = v.id === selected?.id;
            const summary = licenseSummary(v.licensePlan);
            return (
              <label
                key={v.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors duration-200 ${
                  isSelected ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40"
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  value={v.id}
                  checked={isSelected}
                  onChange={() => {
                    setSelectedId(v.id);
                    setStatus("idle");
                  }}
                  className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]"
                />
                <span className="flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-medium text-ink">{v.name}</span>
                    <span className="text-right">
                      <span className="block font-bold text-ink">{money(p.amount, p.currency)}</span>
                      {p.compareAtAmount && p.compareAtAmount > p.amount && (
                        <span className="block text-xs text-muted line-through">{money(p.compareAtAmount, p.currency)}</span>
                      )}
                    </span>
                  </span>
                  {summary && <span className="mt-1 block text-sm text-muted">{summary}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex items-baseline justify-between border-t border-line pt-5">
        <span className="text-sm text-muted">Thành tiền</span>
        <span className="text-2xl font-extrabold text-ink">{price ? money(price.amount, price.currency) : "—"}</span>
      </div>

      <div className="mt-5 space-y-3">
        <button
          type="button"
          onClick={() => void handleAdd(true)}
          disabled={status === "adding" || authLoading}
          className="btn-buy w-full text-base"
        >
          {status === "adding" ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : null}
          Mua ngay
        </button>
        <button
          type="button"
          onClick={() => void handleAdd(false)}
          disabled={status === "adding" || authLoading}
          className="btn-ghost w-full"
        >
          {status === "added" ? <Check aria-hidden className="h-4 w-4 text-cta" /> : <ShoppingBag aria-hidden className="h-4 w-4" />}
          {status === "added" ? "Đã thêm vào giỏ" : "Thêm vào giỏ hàng"}
        </button>
        {status === "added" && (
          <Link href="/cart" className="block text-center text-sm font-semibold text-brand hover:underline">
            Xem giỏ hàng
          </Link>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {!user && !authLoading && (
          <p className="text-center text-sm text-muted">Bạn cần đăng nhập để mua hàng.</p>
        )}
      </div>

      <p className="mt-6 flex items-start gap-2 text-sm leading-6 text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cta" />
        Giá do máy chủ tính lại khi đặt hàng. Đơn chỉ được xác nhận khi ngân hàng báo nhận đủ tiền.
      </p>
    </div>
  );
}
