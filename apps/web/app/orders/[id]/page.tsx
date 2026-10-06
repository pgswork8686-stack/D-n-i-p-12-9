"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  Landmark,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type {
  OrderDto,
  PaymentProvidersResponse,
  PaymentSessionResponse,
  ReconcilePaymentResponse,
} from "@nexus/contracts";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, money, ORDER_STATUS } from "../../lib/format";

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";
const POLL_MS = 5000;
const POLL_LIMIT_MS = 20 * 60 * 1000;

const BANK_NAMES: Record<string, string> = {
  MBBank: "MB Bank",
  Vietcombank: "Vietcombank",
  VietinBank: "VietinBank",
  BIDV: "BIDV",
  ACB: "ACB",
  Techcombank: "Techcombank",
  TPBank: "TPBank",
  VPBank: "VPBank",
};

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [session, setSession] = useState<PaymentSessionResponse | null>(null);
  const [providers, setProviders] = useState<PaymentProvidersResponse["providers"]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  const pendingPayment = order?.payments?.find((p) => p.status === "PENDING");

  const loadOrder = useCallback(async () => {
    if (!token) return;
    try {
      setOrder(await apiFetch<OrderDto>(`/orders/${id}`, { token }));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được đơn hàng.");
    }
  }, [id, token]);

  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=/orders/${id}`);
  }, [authLoading, user, router, id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    apiFetch<PaymentProvidersResponse>("/v1/payments/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  // Re-open the bound bank-transfer session (idempotent on the backend).
  useEffect(() => {
    if (!token || !order || order.status !== "PENDING_PAYMENT") return;
    const p = order.payments?.find((x) => x.status === "PENDING");
    if (!p?.providerReference || p.provider.toLowerCase() !== "sepay" || session) return;
    apiFetch<PaymentSessionResponse>(`/orders/${order.id}/payment-session`, {
      method: "POST",
      token,
      body: { provider: "sepay" },
    })
      .then(setSession)
      .catch(() => setSession(null));
  }, [order, token, session]);

  // Poll while waiting for the bank to confirm.
  useEffect(() => {
    if (order?.status !== "PENDING_PAYMENT") return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) return;
      void loadOrder();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [order?.status, loadOrder]);

  const startPayment = async (provider: string) => {
    if (!token || !order) return;
    setBusy(true);
    setNotice(null);
    try {
      const s = await apiFetch<PaymentSessionResponse>(`/orders/${order.id}/payment-session`, {
        method: "POST",
        token,
        body: {
          provider,
          successUrl: `/orders/${order.id}?status=success`,
          cancelUrl: `/orders/${order.id}?status=cancelled`,
        },
      });
      if (provider === "stripe" && /^https:\/\//.test(s.sessionUrl)) {
        window.location.assign(s.sessionUrl);
        return;
      }
      setSession(provider === "sepay" ? s : null);
      await loadOrder();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Không khởi tạo được thanh toán.");
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async () => {
    if (!token || !pendingPayment) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch<ReconcilePaymentResponse>(`/v1/payments/${pendingPayment.id}/refresh`, {
        method: "POST",
        token,
      });
      await loadOrder();
      if (res.orderStatus !== "PAID") {
        setNotice("Chưa nhận được tiền. Ngân hàng có thể chậm vài phút — trang sẽ tự cập nhật.");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Chưa kiểm tra được. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || (!order && !loadError)) {
    return (
      <div className="container-site flex justify-center py-24" role="status">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-brand" />
        <span className="sr-only">Đang tải đơn hàng…</span>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container-site py-20">
        <div className="card mx-auto max-w-lg p-10 text-center">
          <XCircle aria-hidden className="mx-auto h-12 w-12 text-danger" />
          <h1 className="mt-4 text-2xl font-bold text-ink">Không xem được đơn hàng</h1>
          <p className="mt-2 text-muted">{loadError}</p>
          <Link href="/products" className="btn-primary mt-6">
            Về cửa hàng
          </Link>
        </div>
      </div>
    );
  }

  const status = ORDER_STATUS[order.status] || { label: order.status, tone: "muted" as const };
  const boundProvider = pendingPayment?.providerReference ? pendingPayment.provider.toLowerCase() : null;
  const choosable = providers.filter((p) => p.currencies.includes(order.currency));

  return (
    <div className="container-site py-10 md:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Đơn hàng · {formatDate(order.createdAt)}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">#{order.orderNumber}</h1>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
            status.tone === "ok"
              ? "bg-green-100 text-green-800"
              : status.tone === "warn"
                ? "bg-amber-100 text-amber-900"
                : "bg-slate-100 text-slate-700"
          }`}
        >
          {status.tone === "ok" ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : <Clock aria-hidden className="h-4 w-4" />}
          {status.label}
        </span>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {order.status === "PAID" && (
            <section className="card border-green-200 p-8 text-center" aria-live="polite">
              <CheckCircle2 aria-hidden className="mx-auto h-14 w-14 text-cta" />
              <h2 className="mt-4 text-2xl font-bold text-ink">Thanh toán thành công</h2>
              <p className="mx-auto mt-2 max-w-md text-muted">
                Quyền sử dụng đang được cấp tự động. File tải về và mã bản quyền sẽ có trong trang tài khoản sau ít giây.
              </p>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <a href={`${PORTAL_URL}/downloads`} className="btn-buy">
                  <Download aria-hidden className="h-4 w-4" /> Tải xuống
                </a>
                <a href={`${PORTAL_URL}/licenses`} className="btn-ghost">
                  Quản lý license
                </a>
              </div>
            </section>
          )}

          {order.status === "PENDING_PAYMENT" && boundProvider === "sepay" && session?.instructions && (
            <section className="card p-6 sm:p-8" aria-labelledby="qr-heading">
              <h2 id="qr-heading" className="flex items-center gap-2 text-xl font-semibold text-ink">
                <Landmark aria-hidden className="h-5 w-5 text-brand" /> Quét mã để chuyển khoản
              </h2>
              <div className="mt-6 grid gap-8 md:grid-cols-[240px_1fr]">
                <div className="mx-auto w-full max-w-[240px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={session.instructions.qrImageUrl}
                    alt={`Mã VietQR chuyển ${money(session.instructions.amount, "VND")} với nội dung ${session.instructions.transferContent}`}
                    width={240}
                    height={240}
                    className="aspect-square w-full rounded-xl border border-line bg-white p-2"
                  />
                  <p className="mt-3 text-center text-xs text-muted">Mở app ngân hàng → Quét QR</p>
                </div>
                <dl className="space-y-4">
                  <CopyRow label="Ngân hàng" value={BANK_NAMES[session.instructions.bankCode] || session.instructions.bankCode} />
                  <CopyRow label="Số tài khoản" value={session.instructions.accountNumber} copy />
                  {session.instructions.accountName && <CopyRow label="Chủ tài khoản" value={session.instructions.accountName} />}
                  <CopyRow label="Số tiền" value={money(session.instructions.amount, "VND")} copyValue={String(session.instructions.amount)} copy strong />
                  <CopyRow label="Nội dung chuyển khoản" value={session.instructions.transferContent} copy strong />
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Nhập <strong>đúng số tiền</strong> và <strong>đúng nội dung</strong> để đơn được xác nhận tự động.
                  </p>
                </dl>
              </div>
              <div className="mt-6 flex flex-col items-center gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-muted" role="status" aria-live="polite">
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Đang chờ ngân hàng xác nhận…
                </p>
                <button type="button" onClick={() => void checkNow()} disabled={busy} className="btn-primary">
                  {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden className="h-4 w-4" />}
                  Tôi đã chuyển khoản
                </button>
              </div>
            </section>
          )}

          {order.status === "PENDING_PAYMENT" && boundProvider === "test" && (
            <section className="card border-dashed border-amber-300 p-6" aria-labelledby="test-heading">
              <h2 id="test-heading" className="font-semibold text-ink">
                Cổng thử nghiệm (môi trường dev)
              </h2>
              <p className="mt-2 text-sm text-muted">Bấm để backend đối soát phiên thử nghiệm và chuyển đơn sang “Đã thanh toán”.</p>
              <button type="button" onClick={() => void checkNow()} disabled={busy} className="btn-primary mt-4">
                Xác nhận thanh toán thử
              </button>
            </section>
          )}

          {order.status === "PENDING_PAYMENT" && (!boundProvider || boundProvider === "stripe") && (
            <section className="card p-6" aria-labelledby="pay-heading">
              <h2 id="pay-heading" className="text-lg font-semibold text-ink">
                {search.get("status") === "cancelled" ? "Thanh toán đã bị huỷ — chọn lại phương thức" : "Hoàn tất thanh toán"}
              </h2>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                {choosable.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy || (boundProvider !== null && boundProvider !== p.id)}
                    onClick={() => void startPayment(p.id)}
                    className={p.id === "sepay" ? "btn-buy" : "btn-ghost"}
                  >
                    {p.id === "sepay" ? <Landmark aria-hidden className="h-4 w-4" /> : <CreditCard aria-hidden className="h-4 w-4" />}
                    {p.id === "sepay" ? "Chuyển khoản VietQR" : p.id === "stripe" ? "Thẻ quốc tế" : "Cổng thử nghiệm"}
                  </button>
                ))}
                {choosable.length === 0 && <p className="text-sm text-muted">Cổng thanh toán đang bảo trì.</p>}
              </div>
            </section>
          )}

          {notice && (
            <p role="status" className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-ink">
              {notice}
            </p>
          )}
        </div>

        <aside className="card h-fit p-6" aria-label="Chi tiết đơn hàng">
          <h2 className="text-lg font-semibold text-ink">Sản phẩm</h2>
          <ul className="mt-4 divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="block font-medium text-ink">{i.productName}</span>
                  <span className="text-muted">
                    {i.variantName} × {i.quantity}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(i.lineTotalAmount, i.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-semibold text-ink">Tổng</span>
            <span className="text-xl font-extrabold tabular-nums text-ink">{money(order.totalAmount, order.currency)}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copyValue,
  copy,
  strong,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copy?: boolean;
  strong?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className={`break-all ${strong ? "text-lg font-bold text-ink" : "font-medium text-ink"}`}>{value}</dd>
      </div>
      {copy && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(copyValue ?? value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="btn-ghost min-h-[40px] shrink-0 px-3 text-xs"
          aria-label={`Sao chép ${label.toLowerCase()}`}
        >
          <Copy aria-hidden className="h-4 w-4" />
          <span aria-live="polite">{copied ? "Đã chép" : "Chép"}</span>
        </button>
      )}
    </div>
  );
}
