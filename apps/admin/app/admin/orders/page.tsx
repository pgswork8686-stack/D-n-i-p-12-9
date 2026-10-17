"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OrderDto, OrderStatus, PaginatedResponse } from "@nexus/contracts";
import { Badge } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";
import { getApiUrl } from "../../lib/api";
import { useAuth } from "../../context/auth-context";
import { effectiveAdminToken } from "../../lib/admin-access-token";
import {
  ADMIN_ORDER_PAGE_SIZE,
  ADMIN_ORDER_STATUSES,
  adminOrderQuery,
  adminOrderStatusLabel,
  parseAdminOrderPage,
} from "../../lib/admin-order-filters";

const devToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function AdminOrdersPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [devToken, setDevToken] = useState<string | null>(null);
  const authToken = effectiveAdminToken(token, devToken, devToolsEnabled);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);
  const [data, setData] = useState<PaginatedResponse<OrderDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!authToken) {
      setData(null);
      setError("Vui lòng đăng nhập bằng tài khoản được cấp quyền xem đơn hàng.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setData(null);
    setError(null);
    const load = async () => {
      try {
        const query = adminOrderQuery(page, statusFilter);
        const res = await fetch(getApiUrl() + "/admin/orders?" + query, {
          headers: { Authorization: "Bearer " + authToken },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(
            res.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." :
            res.status === 403 ? "Tài khoản không có quyền xem đơn hàng (403)." :
            "Không tải được đơn hàng. Vui lòng thử lại.",
          );
        }
        const result = parseAdminOrderPage(await res.json());
        if (live) setData(result);
      } catch (cause) {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Không tải được đơn hàng.");
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => {
      live = false;
      controller.abort();
    };
  }, [authToken, authLoading, page, statusFilter, refreshCount]);

  const onStatusChange = (newStatus: string) => {
    // Filter values come from a fixed allowlist, never arbitrary URL input.
    const value = ADMIN_ORDER_STATUSES.find(item => item.value === newStatus)?.value ?? "";
    setPage(1);
    setStatusFilter(value);
  };

  const getStatusBadge = (status: OrderStatus) => {
    const variant = status === "PAID" ? "success" :
      status === "CANCELLED" ? "error" : "warning";
    return <Badge variant={variant}>{adminOrderStatusLabel(status)}</Badge>;
  };

  const orders = data?.items ?? [];
  const pageCount = data?.totalPages ?? 1;
  const canPrevious = Boolean(data && page > 1 && !loading);
  const canNext = Boolean(data && page < pageCount && !loading);

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">Quản lý đơn hàng</h1>
          <p className="mt-2 text-sm text-slate-600">
            Dữ liệu và trạng thái thanh toán được xác thực từ API. Trang này chỉ có quyền xem.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/admin/products" className="text-sm font-semibold text-blue-700 hover:underline">Sản phẩm</Link>
          <button type="button" onClick={() => setRefreshCount(x => x + 1)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">
            Tải lại
          </button>
        </div>
      </header>

      {devToolsEnabled && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 text-sm">
          <span>Kiểm thử phân quyền (chỉ môi trường phát triển):</span>
          <button type="button" onClick={() => setDevToken("dev-admin-token")} className="rounded-lg border p-2">Admin</button>
          <button type="button" onClick={() => setDevToken("dev-customer-token")} className="rounded-lg border p-2">Customer (403)</button>
          <button type="button" onClick={() => setDevToken("")} className="rounded-lg border p-2">Không có token (401)</button>
          <button type="button" onClick={() => setDevToken(null)} className="rounded-lg border p-2">Phiên thật</button>
        </div>
      )}

      <section className="mt-6 rounded-2xl border bg-white p-5" aria-label="Bộ lọc đơn hàng">
        <label htmlFor="order-status" className="text-sm font-semibold">Trạng thái</label>
        <select id="order-status" value={statusFilter} onChange={event => onStatusChange(event.target.value)}
          className="mt-2 block w-full max-w-sm rounded-xl border border-slate-300 bg-white p-3 text-sm">
          {ADMIN_ORDER_STATUSES.map(item =>
            <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {data && (
          <p role="status" className="mt-3 text-sm text-slate-600">
            Có {data.total} đơn hàng phù hợp · Trang {page} / {pageCount}
          </p>
        )}
      </section>

      <section aria-label="Danh sách đơn hàng" className="mt-6">
        {authLoading || loading ? (
          <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải đơn hàng…</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={() => setRefreshCount(x => x + 1)}
              className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
            {!authToken && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center">
            <p className="font-semibold">Không có đơn hàng phù hợp</p>
            <p className="mt-2 text-sm text-slate-500">
              {statusFilter ? "Thử chọn trạng thái khác." : "Đơn hàng mới sẽ xuất hiện tại đây khi được tạo qua checkout."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-5 py-4">Mã đơn</th>
                  <th scope="col" className="px-5 py-4">Khách hàng (ID)</th>
                  <th scope="col" className="px-5 py-4">Trạng thái</th>
                  <th scope="col" className="px-5 py-4">Tổng tiền</th>
                  <th scope="col" className="px-5 py-4">Sản phẩm</th>
                  <th scope="col" className="px-5 py-4">Ngày tạo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-mono font-semibold text-blue-700">
                      <Link href={`/admin/orders/${order.id}`} className="hover:underline">{order.orderNumber}</Link>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600">{order.userId}</td>
                    <td className="px-5 py-4">{getStatusBadge(order.status)}</td>
                    <td className="px-5 py-4 font-semibold">{formatMoney(order.totalAmount, order.currency)}</td>
                    <td className="px-5 py-4">{order.items.length} mục</td>
                    <td className="px-5 py-4 text-slate-600">{new Date(order.createdAt).toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && !error && data.totalPages > 1 && (
          <nav aria-label="Phân trang đơn hàng" className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" disabled={!canPrevious} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
              ← Trang trước
            </button>
            <span className="text-sm text-slate-600">Trang {page} / {pageCount} · {ADMIN_ORDER_PAGE_SIZE} đơn/trang</span>
            <button type="button" disabled={!canNext} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
              Trang sau →
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}
