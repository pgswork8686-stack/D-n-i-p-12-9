"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, FlaskConical, Landmark, Loader2, Lock, ShieldCheck } from "lucide-react";
import type { CheckoutResponse, PaymentProvidersResponse, PaymentSessionResponse } from "@nexus/contracts";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { DEFAULT_CURRENCY, money } from "../lib/format";

const METHOD_COPY: Record<string, { title: string; text: string; icon: typeof Landmark }> = {
  sepay: {
    title: "Chuyển khoản ngân hàng (VietQR)",
    text: "Quét mã bằng app ngân hàng bất kỳ. Xác nhận tự động trong vài giây đến vài phút.",
    icon: Landmark,
  },
  stripe: {
    title: "Thẻ quốc tế",
    text: "Visa, Mastercard, JCB qua cổng Stripe bảo mật.",
    icon: CreditCard,
  },
  test: {
    title: "Cổng thử nghiệm",
    text: "Chỉ có ở môi trường phát triển — không dùng tiền thật.",
    icon: FlaskConical,
  },
};

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const { cart, isLoading: cartLoading, refresh } = useCart();
  const [providers, setProviders] = useState<PaymentProvidersResponse["providers"] | null>(null);
  const [method, setMethod] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per checkout attempt: a double click never creates two orders.
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/checkout");
  }, [authLoading, user, router]);

  useEffect(() => {
    apiFetch<PaymentProvidersResponse>("/v1/payments/providers")
      .then((res) => {
        const usable = res.providers.filter((p) => p.currencies.includes(DEFAULT_CURRENCY));
        setProviders(usable);
        setMethod((m) => m || usable[0]?.id || "");
      })
      .catch(() => setProviders([]));
  }, []);

  const items = useMemo(() => cart?.items ?? [], [cart]);
  const blocked = useMemo(() => items.some((i) => !i.isAvailable), [items]);

  const placeOrder = async () => {
    if (!token || !method) return;
    setSubmitting(true);
    setError(null);
    try {
      const checkout = await apiFetch<CheckoutResponse>("/checkout", {
        method: "POST",
        token,
        body: { currency: DEFAULT_CURRENCY, idempotencyKey: idempotencyKey.current },
      });
      const orderId = checkout.order.id;
      void refresh();
      let session: PaymentSessionResponse;
      try {
        session = await apiFetch<PaymentSessionResponse>(`/orders/${orderId}/payment-session`, {
          method: "POST",
          token,
          body: {
            provider: method,
            successUrl: `/orders/${orderId}?status=success`,
            cancelUrl: `/orders/${orderId}?status=cancelled`,
          },
        });
      } catch {
        // The order exists; let the customer retry payment from the order page.
        router.push(`/orders/${orderId}?status=retry`);
        return;
      }
      if (method === "stripe" && /^https:\/\//.test(session.sessionUrl)) {
        window.location.assign(session.sessionUrl);
        return;
      }
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được đơn hàng.");
      idempotencyKey.current = newIdempotencyKey();
      setSubmitting(false);
    }
  };

  if (authLoading || !user || (cartLoading && !cart)) {
    return (
      <div className="container-site flex justify-center py-24" role="status">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-brand" />
        <span className="sr-only">Đang tải…</span>
      </div>
    );
  }

  if (items.length === 0 && !submitting) {
    return (
      <div className="container-site py-20">
        <div className="card mx-auto max-w-lg p-10 text-center">
          <h1 className="text-2xl font-bold text-ink">Không có gì để thanh toán</h1>
          <p className="mt-2 text-muted">Giỏ hàng của bạn đang trống.</p>
          <Link href="/products" className="btn-primary mt-6">
            Xem sản phẩm
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-site py-10 md:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Thanh toán</h1>
      <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted" aria-label="Tiến trình">
        <li>Giỏ hàng</li>
        <li aria-hidden>›</li>
        <li className="font-semibold text-brand" aria-current="step">
          Thanh toán
        </li>
        <li aria-hidden>›</li>
        <li>Nhận hàng</li>
      </ol>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <section className="card p-6" aria-labelledby="account-heading">
            <h2 id="account-heading" className="text-lg font-semibold text-ink">
              Tài khoản nhận hàng
            </h2>
            <p className="mt-2 text-muted">
              File tải về, mã bản quyền và hoá đơn sẽ gắn với <span className="font-medium text-ink">{user.email}</span>.
            </p>
          </section>

          <section className="card p-6" aria-labelledby="method-heading">
            <h2 id="method-heading" className="text-lg font-semibold text-ink">
              Phương thức thanh toán
            </h2>
            {providers === null ? (
              <p className="mt-4 flex items-center gap-2 text-muted" role="status">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Đang tải phương thức…
              </p>
            ) : providers.length === 0 ? (
              <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Cổng thanh toán đang bảo trì. Vui lòng thử lại sau ít phút.
              </p>
            ) : (
              <fieldset className="mt-4 space-y-3">
                <legend className="sr-only">Chọn phương thức thanh toán</legend>
                {providers.map((p) => {
                  const copy = METHOD_COPY[p.id] || { title: p.id, text: "", icon: CreditCard };
                  const checked = method === p.id;
                  return (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors duration-200 ${
                        checked ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="method"
                        value={p.id}
                        checked={checked}
                        onChange={() => setMethod(p.id)}
                        className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]"
                      />
                      <copy.icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                      <span>
                        <span className="block font-medium text-ink">{copy.title}</span>
                        <span className="mt-0.5 block text-sm text-muted">{copy.text}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          </section>
        </div>

        <aside className="card h-fit p-6 lg:sticky lg:top-24" aria-label="Đơn hàng">
          <h2 className="text-lg font-semibold text-ink">Đơn hàng</h2>
          <ul className="mt-4 divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{i.productName}</span>
                  <span className="text-muted">
                    {i.variantName} × {i.quantity}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{money(i.lineTotalAmount, i.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-semibold text-ink">Tổng thanh toán</span>
            <span className="text-2xl font-extrabold tabular-nums text-ink">{money(cart!.totalAmount, cart!.currency)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Số tiền cuối cùng do máy chủ tính lại khi tạo đơn.</p>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void placeOrder()}
            disabled={submitting || !method || blocked || !providers?.length}
            className="btn-buy mt-5 w-full text-base"
          >
            {submitting ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : <Lock aria-hidden className="h-4 w-4" />}
            Đặt hàng &amp; thanh toán
          </button>
          {blocked && (
            <p className="mt-3 text-sm text-danger">
              Giỏ có sản phẩm không còn bán. <Link href="/cart" className="underline">Quay lại giỏ hàng</Link>
            </p>
          )}
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cta" />
            Chúng tôi không lưu thông tin thẻ. Đơn chỉ chuyển sang “Đã thanh toán” khi cổng thanh toán hoặc ngân hàng xác nhận.
          </p>
        </aside>
      </div>
    </div>
  );
}
