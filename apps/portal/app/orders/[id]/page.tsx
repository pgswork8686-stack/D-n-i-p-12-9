"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { OrderDto } from "@nexus/contracts";
import { formatMoney } from "@nexus/utils";
import { Button } from "@nexus/ui";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { StatusBadge } from "../../components/status-badge";
import { Skeleton } from "../../components/skeleton";
import { ErrorState } from "../../components/error-state";
import {
  formatViDate,
  formatViTime,
  itemEntitlementSummary,
  paymentProviderLabel,
  succeededPayment,
} from "../../lib/portal-orders";

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params?.id as string;
  const { token } = useAuth();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrderDetail = useCallback(async () => {
    if (!token || !orderId) return;
    setLoading(true);
    setError(null);
    try {
      setOrder(await getApiClient(token).getOrder(orderId));
    } catch (err: any) {
      setError(err.message || "Không tải được đơn hàng.");
    } finally {
      setLoading(false);
    }
  }, [token, orderId]);

  useEffect(() => {
    void fetchOrderDetail();
  }, [fetchOrderDetail]);

  // Payment (VietQR via SePay, or card via Stripe) is completed on the storefront order page,
  // which lists the providers enabled on the backend.
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
  const paid = order ? succeededPayment(order) : null;
  const firstPayment = order?.payments?.[0] ?? null;

  const info = (label: string, value: React.ReactNode, note?: string) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-black text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-5xl space-y-6">
          <nav aria-label="Đường dẫn" className="text-xs text-slate-500">
            <Link href="/orders" className="font-semibold text-[#0037b0] hover:underline">Đơn hàng</Link>
            <span aria-hidden="true"> / </span>
            <span>{order?.orderNumber ?? "…"}</span>
          </nav>

          {error && <ErrorState message={error} onRetry={fetchOrderDetail} />}

          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-60 w-full rounded-2xl" />
            </div>
          ) : !order ? (
            !error && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">Không tìm thấy đơn hàng.</div>
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-900">Đơn hàng {order.orderNumber}</h1>
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <StatusBadge status={order.status} kind="order" />
                    <span>Đặt lúc {formatViTime(order.createdAt)} · {formatViDate(order.createdAt)}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/tickets"><Button variant="outline" size="sm">Gửi yêu cầu hỗ trợ</Button></Link>
                  {order.status === "PAID" && <Link href="/entitlements"><Button variant="primary" size="sm">Mở sản phẩm của tôi</Button></Link>}
                </div>
              </header>

              <section aria-label="Tóm tắt" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {info("Ngày đặt", formatViDate(order.createdAt))}
                {info("Phương thức", paymentProviderLabel((paid ?? firstPayment)?.provider))}
                {info("Tổng tiền", formatMoney(order.totalAmount, order.currency))}
                {info("Thanh toán", paid ? formatViTime(paid.updatedAt) : "Chưa xác nhận", paid ? "Xác nhận qua webhook của nhà cung cấp" : "Trạng thái chỉ đổi khi máy chủ nhận xác nhận")}
              </section>

              {order.status === "PENDING_PAYMENT" && (
                <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <div>
                    <h2 className="font-bold text-amber-900">Đơn đang chờ thanh toán</h2>
                    <p className="mt-1 text-sm text-amber-800">Quay lại trang thanh toán để quét VietQR hoặc chọn phương thức khác. Đơn chỉ chuyển sang “Đã thanh toán” khi ngân hàng xác nhận.</p>
                  </div>
                  <a href={`${webUrl}/orders/${order.id}`}><Button variant="primary" size="sm">Tiếp tục thanh toán</Button></a>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <section aria-label="Mặt hàng" className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h2 className="text-lg font-bold">Mặt hàng</h2>
                  <p className="mt-1 text-xs text-slate-500">Quyền sử dụng được chụp tại thời điểm mua, không đổi theo catalog hiện tại</p>
                  <ul className="mt-4 divide-y divide-slate-100">
                    {(order.items ?? []).map(item => (
                      <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                        <div>
                          <p className="font-semibold text-slate-900">{item.productName}</p>
                          <p className="mt-1 text-xs text-slate-500">{itemEntitlementSummary(item)}</p>
                          {item.quantity > 1 && <p className="mt-1 text-xs text-slate-500">Số lượng: {item.quantity}</p>}
                        </div>
                        <p className="font-extrabold text-slate-900">{formatMoney(item.lineTotalAmount, order.currency)}</p>
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-label="Thanh toán" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
                  <h2 className="text-lg font-bold">Thanh toán</h2>
                  <dl className="mt-4 space-y-3">
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Tạm tính</dt><dd>{formatMoney(order.subtotalAmount, order.currency)}</dd></div>
                    {order.discountAmount > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-500">Giảm giá</dt><dd>-{formatMoney(order.discountAmount, order.currency)}</dd></div>}
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Phương thức</dt><dd>{paymentProviderLabel((paid ?? firstPayment)?.provider)}</dd></div>
                    {(paid ?? firstPayment)?.providerReference && (
                      <div className="flex justify-between gap-3"><dt className="text-slate-500">Mã giao dịch</dt><dd className="font-mono text-xs">{(paid ?? firstPayment)!.providerReference}</dd></div>
                    )}
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Trạng thái</dt><dd><StatusBadge status={paid ? "PAID" : order.status} kind="order" /></dd></div>
                    <div className="flex justify-between gap-3 border-t border-slate-100 pt-3 text-base"><dt className="font-bold">Tổng cộng</dt><dd className="text-xl font-black">{formatMoney(order.totalAmount, order.currency)}</dd></div>
                  </dl>
                </section>
              </div>

              {order.status === "PAID" && (
                <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div>
                    <h2 className="font-bold text-emerald-900">Quyền sử dụng đã sẵn sàng</h2>
                    <p className="mt-1 text-sm text-emerald-800">File và license của đơn hàng có trong tài khoản của bạn.</p>
                  </div>
                  <Link href="/entitlements"><Button variant="primary" size="sm">Mở sản phẩm của tôi</Button></Link>
                </div>
              )}

              <section aria-label="Lịch sử xử lý" className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-lg font-bold">Lịch sử xử lý</h2>
                <ol className="mt-4 space-y-4 text-sm">
                  <li className="flex justify-between gap-3">
                    <span><span className="block font-semibold">Tạo đơn hàng</span><span className="block text-xs text-slate-500">Giá được máy chủ tính lại từ giỏ hàng</span></span>
                    <time dateTime={order.createdAt} className="text-xs text-slate-500">{formatViTime(order.createdAt)}</time>
                  </li>
                  {paid && (
                    <li className="flex justify-between gap-3">
                      <span><span className="block font-semibold">Ngân hàng xác nhận thanh toán</span><span className="block text-xs text-slate-500">Nhà cung cấp thanh toán đã báo thành công và máy chủ đã xác thực</span></span>
                      <time dateTime={paid.updatedAt} className="text-xs text-slate-500">{formatViTime(paid.updatedAt)}</time>
                    </li>
                  )}
                </ol>
              </section>
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
