"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TicketStatus } from "@nexus/contracts";
import { Badge } from "@nexus/ui";
import { useAuth } from "../../context/auth-context";
import { AdminApiError, adminFetch } from "../../lib/admin-http";
import {
  ADMIN_TICKET_PAGE_SIZE,
  ADMIN_TICKET_STATUSES,
  adminTicketPriorityLabel,
  adminTicketQuery,
  adminTicketStatusLabel,
  parseAdminTicketPage,
  type AdminTicketPage,
} from "../../lib/admin-tickets";

function statusVariant(status: TicketStatus): "success" | "warning" | "error" | "info" {
  if (status === "RESOLVED" || status === "CLOSED") return "success";
  if (status === "WAITING_STAFF") return "warning";
  if (status === "WAITING_CUSTOMER") return "info";
  return "info";
}

export default function AdminTicketsPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<TicketStatus | "">("WAITING_STAFF");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<AdminTicketPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setData(null);
      setError("Vui lòng đăng nhập bằng tài khoản được cấp quyền xem ticket.");
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    adminFetch<unknown>("/admin/tickets?" + adminTicketQuery(page, status), token, "ticket")
      .then(json => { if (live) setData(parseAdminTicketPage(json)); })
      .catch(cause => {
        if (!live) return;
        setData(null);
        setError(cause instanceof AdminApiError ? cause.message : "Không tải được danh sách ticket.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, authLoading, page, status, refresh]);

  const pageCount = data?.totalPages ?? 1;

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">Ticket hỗ trợ</h1>
          <p className="mt-2 text-sm text-slate-600">
            Ticket được sắp xếp theo độ ưu tiên rồi thời gian cập nhật. Cần quyền xem ticket để mở trang này.
          </p>
        </div>
        <button type="button" onClick={() => setRefresh(x => x + 1)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">
          Tải lại
        </button>
      </header>

      <nav aria-label="Lọc theo trạng thái" className="mt-6 flex flex-wrap gap-2">
        {ADMIN_TICKET_STATUSES.map(item => (
          <button key={item.value || "all"} type="button"
            aria-pressed={status === item.value}
            onClick={() => { setPage(1); setStatus(item.value); }}
            className={"rounded-full border px-4 py-2 text-sm font-semibold " +
              (status === item.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white hover:bg-slate-100")}>
            {item.label}
          </button>
        ))}
      </nav>

      <section aria-label="Danh sách ticket" className="mt-6">
        {authLoading || loading ? (
          <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải ticket…</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={() => setRefresh(x => x + 1)}
              className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
            {!token && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center">
            <p className="font-semibold">Không có ticket phù hợp</p>
            <p className="mt-2 text-sm text-slate-500">Thử chọn trạng thái khác.</p>
          </div>
        ) : (
          <div className="relative overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-5 py-4">Mã</th>
                  <th scope="col" className="px-5 py-4">Chủ đề</th>
                  <th scope="col" className="px-5 py-4">Khách (ID)</th>
                  <th scope="col" className="px-5 py-4">Ưu tiên</th>
                  <th scope="col" className="px-5 py-4">Trạng thái</th>
                  <th scope="col" className="px-5 py-4">Cập nhật</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map(ticket => (
                  <tr key={ticket.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-mono font-semibold text-blue-700">
                      <Link href={`/admin/tickets/${ticket.id}`} className="hover:underline">{ticket.ticketNumber}</Link>
                    </td>
                    <td className="px-5 py-4">{ticket.subject}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600">{ticket.userId}</td>
                    <td className="px-5 py-4">{adminTicketPriorityLabel(ticket.priority)}</td>
                    <td className="px-5 py-4"><Badge variant={statusVariant(ticket.status)}>{adminTicketStatusLabel(ticket.status)}</Badge></td>
                    <td className="px-5 py-4 text-slate-600">{new Date(ticket.updatedAt).toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && !error && data.totalPages > 1 && (
          <nav aria-label="Phân trang ticket" className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">← Trang trước</button>
            <span className="text-sm text-slate-600">Trang {page} / {pageCount} · {data.total} ticket · {ADMIN_TICKET_PAGE_SIZE}/trang</span>
            <button type="button" disabled={page >= pageCount || loading} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Trang sau →</button>
          </nav>
        )}
      </section>
    </main>
  );
}
