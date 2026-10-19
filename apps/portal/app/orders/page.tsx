"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { OrderDto, OrderStatus } from "@nexus/contracts";
import { formatMoney } from "@nexus/utils";
import { Button } from "@nexus/ui";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { TableSkeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { ORDER_PAGE_SIZE, ORDER_STATUS_FILTERS, filterOrders, formatViDate, orderProductSummary, paginate } from "../lib/portal-orders";

export default function OrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getApiClient(token).listOrders({ limit: 50 });
      setOrders(res.items || []);
    } catch (err: any) {
      setError(err.message || "Không tải được danh sách đơn hàng.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const filtered = filterOrders(orders, status, search);
  const paged = paginate(filtered, page);
  const visible = paged.items;

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <header>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Đơn hàng của tôi</h1>
            <p className="mt-1 text-sm text-slate-500">Trạng thái thanh toán do máy chủ xác nhận — trang này chỉ hiển thị.</p>
          </header>

          {error && <ErrorState message={error} onRetry={fetchOrders} />}

          {!error && (
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <div>
                <label htmlFor="order-search" className="sr-only">Tìm theo mã đơn</label>
                <input id="order-search" value={search} onChange={e => { setPage(1); setSearch(e.target.value); }}
                  placeholder="Tìm theo mã đơn (VD: NXS-2026-00128)…"
                  className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm" />
              </div>
              <div>
                <label htmlFor="order-status" className="sr-only">Lọc theo trạng thái</label>
                <select id="order-status" value={status} onChange={e => { setPage(1); setStatus(e.target.value as OrderStatus | ""); }}
                  className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
                  {ORDER_STATUS_FILTERS.map(item => <option key={item.value || "all"} value={item.value}>{item.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : orders.length === 0 && !error ? (
            <EmptyState
              title="Chưa có đơn hàng nào"
              description="Bạn chưa đặt đơn hàng nào. Khám phá theme, plugin và UI kit trong cửa hàng."
              actionText="Khám phá cửa hàng"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : filtered.length === 0 && !error ? (
            <div className="rounded-2xl border bg-white p-10 text-center">
              <p className="font-semibold">Không có đơn hàng phù hợp</p>
              <p className="mt-2 text-sm text-slate-500">Thử đổi trạng thái hoặc mã đơn khác.</p>
            </div>
          ) : !error && (
            <div className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-5 py-4">Mã đơn</th>
                    <th scope="col" className="px-5 py-4">Ngày đặt</th>
                    <th scope="col" className="px-5 py-4">Sản phẩm</th>
                    <th scope="col" className="px-5 py-4">Tổng tiền</th>
                    <th scope="col" className="px-5 py-4">Trạng thái</th>
                    <th scope="col" className="px-5 py-4"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-4 font-mono font-bold text-slate-900">{order.orderNumber}</td>
                      <td className="px-5 py-4 text-slate-600">{formatViDate(order.createdAt)}</td>
                      <td className="px-5 py-4 text-slate-600">{orderProductSummary(order)}</td>
                      <td className="px-5 py-4 font-extrabold text-slate-900">{formatMoney(order.totalAmount, order.currency)}</td>
                      <td className="px-5 py-4"><StatusBadge status={order.status} kind="order" /></td>
                      <td className="px-5 py-4 text-right">
                        <Link href={`/orders/${order.id}`}><Button variant="outline" size="sm">Xem</Button></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <nav aria-label="Phân trang đơn hàng" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <span role="status">Trang {paged.page} · {ORDER_PAGE_SIZE} đơn mỗi trang · {paged.total} đơn phù hợp</span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>← Trước</Button>
                <Button variant="outline" size="sm" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.page + 1)}>Sau →</Button>
              </span>
            </nav>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
