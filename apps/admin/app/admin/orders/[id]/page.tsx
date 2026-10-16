"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { OrderDto } from "@nexus/contracts";
import { formatMoney } from "@nexus/utils";
import { useAuth } from "../../../context/auth-context";
import { getApiUrl } from "../../../lib/api";

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, isLoading: authLoading } = useAuth();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setLoading(false);
      setError("Bạn cần đăng nhập để xem đơn hàng.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetch(getApiUrl() + "/admin/orders/" + encodeURIComponent(id), {
          headers: { Authorization: "Bearer " + token }, cache: "no-store",
        });
        if (!response.ok) throw new Error(
          response.status === 403 ? "Bạn không có quyền xem đơn hàng này." :
          response.status === 404 ? "Đơn hàng không tồn tại." : "Không thể tải đơn hàng.",
        );
        const body = await response.json() as OrderDto;
        if (!cancelled) setOrder(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Lỗi kết nối API.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token, authLoading]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-10">
      <Link href="/admin/orders" className="text-sm font-semibold text-blue-700 hover:underline">← Danh sách đơn hàng</Link>
      <header><h1 className="text-3xl font-bold text-slate-900">Chi tiết đơn hàng</h1>
        <p className="mt-2 text-sm text-slate-500">Trạng thái do backend xác thực, giao diện này chỉ đọc.</p></header>
      {loading && <p role="status">Đang tải đơn hàng…</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {!loading && !error && order && (
        <>
          <section aria-label="Thông tin đơn hàng" className="grid gap-5 rounded-2xl border bg-white p-6 sm:grid-cols-2">
            <div><p className="text-sm text-slate-500">Mã đơn</p><p className="font-mono font-bold">{order.orderNumber}</p></div>
            <div><p className="text-sm text-slate-500">Trạng thái</p><p className="font-semibold">{order.status}</p></div>
            <div><p className="text-sm text-slate-500">Khách hàng (ID)</p><p className="break-all font-mono text-xs">{order.userId}</p></div>
            <div><p className="text-sm text-slate-500">Ngày tạo</p><p>{new Date(order.createdAt).toLocaleString("vi-VN")}</p></div>
            <div><p className="text-sm text-slate-500">Tổng tiền</p><p className="text-xl font-bold">{formatMoney(order.totalAmount, order.currency)}</p></div>
          </section>
          <section className="overflow-x-auto rounded-2xl border bg-white p-5" aria-labelledby="order-items">
            <h2 id="order-items" className="mb-4 text-lg font-bold">Sản phẩm trong đơn</h2>
            {order.items.length ? (
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead><tr className="border-b"><th className="p-3">Sản phẩm</th><th className="p-3">Gói</th><th className="p-3">SL</th><th className="p-3 text-right">Thành tiền</th></tr></thead>
                <tbody>{order.items.map(item => <tr key={item.id} className="border-b">
                  <td className="p-3">{item.productName}</td><td className="p-3">{item.variantName}</td>
                  <td className="p-3">{item.quantity}</td><td className="p-3 text-right">{formatMoney(item.lineTotalAmount, item.currency)}</td>
                </tr>)}</tbody>
              </table>
            ) : <p className="text-slate-500">Không có sản phẩm.</p>}
          </section>
          <section className="rounded-2xl border bg-white p-5" aria-labelledby="order-payments">
            <h2 id="order-payments" className="mb-4 text-lg font-bold">Thanh toán</h2>
            {order.payments?.length ? <ul className="space-y-3">{order.payments.map(payment => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-3 rounded-xl bg-slate-50 p-4">
                <span>{payment.provider} · {payment.status}</span>
                <span className="font-semibold">{formatMoney(payment.amount, payment.currency)}</span>
                <span className="w-full break-all font-mono text-xs text-slate-500">{payment.id}</span>
              </li>
            ))}</ul> : <p className="text-slate-500">Chưa có giao dịch.</p>}
            <p className="mt-4 text-xs text-slate-500">Trang này không thể tự xác nhận thanh toán; đối soát phải qua API có quyền.</p>
          </section>
        </>
      )}
    </main>
  );
}
