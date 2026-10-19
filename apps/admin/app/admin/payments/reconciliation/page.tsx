"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@nexus/ui";
import { useAuth } from "../../../context/auth-context";
import { AdminApiError, adminFetch } from "../../../lib/admin-http";
import { useCan } from "../../../lib/permissions";
import { useAdminQuery } from "../../../lib/use-admin-query";
import {
  RECONCILIATION_PAGE_SIZE,
  RECONCILIATION_REASONS,
  RECONCILIATION_STATUS_FILTERS,
  differenceLabel,
  formatMoney,
  parseReconciliationPage,
  reasonLabel,
  reconciliationQuery,
  statusLabel,
  validateResolutionNote,
  type ReconciliationCase,
  type ReconciliationReason,
  type ReconciliationStatus,
} from "../../../lib/admin-reconciliation";

const when = (value?: string | null) => (value ? new Date(value).toLocaleString("vi-VN") : "—");

export default function AdminReconciliationPage() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can("payment.manage");
  const [status, setStatus] = useState<ReconciliationStatus | "">("OPEN");
  const [reason, setReason] = useState<ReconciliationReason | "">("");
  const [page, setPage] = useState(1);
  const { data, loading, error, signedIn, reload } = useAdminQuery(
    "/admin/payments/reconciliation?" + reconciliationQuery(page, status, reason),
    "đối soát thanh toán",
    parseReconciliationPage,
  );
  const [selected, setSelected] = useState<ReconciliationCase | null>(null);
  const [resolution, setResolution] = useState<"RESOLVED" | "DISMISSED">("RESOLVED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const act = async (path: string, body: unknown, okText: string) => {
    if (!token || !selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await adminFetch<ReconciliationCase>(
        "/admin/payments/reconciliation/" + encodeURIComponent(selected.id) + path, token, "đối soát thanh toán",
        { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) },
      );
      setSelected(updated);
      setNotice({ tone: "ok", text: okText });
      reload();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof AdminApiError ? cause.message : "Thao tác thất bại." });
    } finally {
      setBusy(false);
    }
  };

  const submitResolution = () => {
    const problem = validateResolutionNote(note);
    if (problem) { setNotice({ tone: "error", text: problem }); return; }
    void act("/resolve", { resolution, note: note.trim() }, resolution === "RESOLVED" ? "Đã ghi nhận xử lý." : "Đã bỏ qua giao dịch.").then(() => setNote(""));
  };

  const items = data?.items ?? [];
  const pageCount = data?.totalPages ?? 1;

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">Đối soát thanh toán</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Các khoản chuyển khoản ngân hàng nhận được nhưng hệ thống không tự xác nhận được: sai số tiền (thiếu hoặc thừa), mã không khớp đơn nào, hoặc không có mã.
            Không giao dịch nào ở đây tự động đánh dấu đơn đã thanh toán.
          </p>
        </div>
        <button type="button" onClick={reload} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Tải lại</button>
      </header>

      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"}
          className={"mt-5 rounded-xl border p-4 text-sm " + (notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
          {notice.text}
        </div>
      )}

      <section aria-label="Bộ lọc" className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2">
        <div>
          <label htmlFor="r-status" className="text-sm font-semibold">Trạng thái</label>
          <select id="r-status" value={status} onChange={e => { setPage(1); setStatus(e.target.value as ReconciliationStatus | ""); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
            {RECONCILIATION_STATUS_FILTERS.map(s => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="r-reason" className="text-sm font-semibold">Lý do</label>
          <select id="r-reason" value={reason} onChange={e => { setPage(1); setReason(e.target.value as ReconciliationReason | ""); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
            {RECONCILIATION_REASONS.map(s => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {data && <p role="status" className="text-sm text-slate-600 sm:col-span-2">Có {data.total} giao dịch phù hợp · {data.openCount} đang chờ xử lý · Trang {page} / {pageCount}</p>}
      </section>

      <section aria-label="Danh sách giao dịch cần đối soát" className="mt-6">
        {loading ? (
          <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải giao dịch…</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={reload} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
            {!signedIn && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center">
            <p className="font-semibold">Không có giao dịch cần đối soát</p>
            <p className="mt-2 text-sm text-slate-500">Mọi khoản chuyển khoản đã khớp đơn hàng, hoặc bộ lọc chưa có kết quả.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="relative overflow-x-auto rounded-2xl border bg-white">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-5 py-4">Thời gian</th>
                    <th scope="col" className="px-5 py-4">Mã chuyển khoản</th>
                    <th scope="col" className="px-5 py-4">Số tiền đơn</th>
                    <th scope="col" className="px-5 py-4">Số tiền nhận</th>
                    <th scope="col" className="px-5 py-4">Chênh lệch</th>
                    <th scope="col" className="px-5 py-4">Trạng thái</th>
                    <th scope="col" className="px-5 py-4"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(item => (
                    <tr key={item.id} className={"hover:bg-slate-50 " + (selected?.id === item.id ? "bg-blue-50/50" : "")}>
                      <td className="px-5 py-4 text-slate-600">{when(item.createdAt)}</td>
                      <td className="px-5 py-4 font-mono text-xs">{item.transferCode ?? "—"}</td>
                      <td className="px-5 py-4">{formatMoney(item.expectedAmount, item.currency)}</td>
                      <td className="px-5 py-4 font-semibold">{formatMoney(item.receivedAmount, item.currency)}</td>
                      <td className="px-5 py-4">{differenceLabel(item.difference, item.currency)}</td>
                      <td className="px-5 py-4">
                        <Badge variant={item.status === "OPEN" ? "warning" : item.status === "RESOLVED" ? "success" : "info"}>{statusLabel(item.status)}</Badge>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button type="button" onClick={() => { setNotice(null); setNote(""); setSelected(item); }}
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100">Chi tiết</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <aside aria-label="Chi tiết giao dịch" className="rounded-2xl border bg-white p-5 text-sm">
              {!selected ? (
                <p className="text-slate-500">Chọn “Chi tiết” ở một giao dịch để xem và xử lý.</p>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold">{reasonLabel(selected.reason)}</h2>
                  <dl className="grid grid-cols-2 gap-3">
                    <div><dt className="text-slate-500">Mã chuyển khoản</dt><dd className="font-mono text-xs">{selected.transferCode ?? "—"}</dd></div>
                    <div><dt className="text-slate-500">Chênh lệch</dt><dd className="font-semibold">{differenceLabel(selected.difference, selected.currency)}</dd></div>
                    <div><dt className="text-slate-500">Số tiền đơn</dt><dd>{formatMoney(selected.expectedAmount, selected.currency)}</dd></div>
                    <div><dt className="text-slate-500">Số tiền nhận</dt><dd>{formatMoney(selected.receivedAmount, selected.currency)}</dd></div>
                  </dl>
                  {selected.orderId && (
                    <p><Link className="font-semibold text-blue-700 hover:underline" href={`/admin/orders/${selected.orderId}`}>Xem đơn hàng liên quan →</Link></p>
                  )}

                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="font-semibold">Truy vấn lại SePay</p>
                    {selected.lastRequery ? (
                      <div className="mt-2 space-y-1 text-slate-700" role="status">
                        <p>Kiểm tra lúc {when(selected.lastRequery.checkedAt)}: ngân hàng ghi nhận {selected.lastRequery.transfers.length} giao dịch, tổng {formatMoney(selected.lastRequery.totalReceived, selected.currency)}.</p>
                        <p className="text-xs text-slate-500">Chỉ để tham khảo — hệ thống không tự xác nhận thanh toán.</p>
                      </div>
                    ) : <p className="mt-1 text-slate-500">Chưa truy vấn lần nào.</p>}
                    <button type="button" disabled={!canManage || busy || !selected.transferCode}
                      title={!canManage ? "Cần quyền payment.manage" : !selected.transferCode ? "Giao dịch không có mã để truy vấn" : undefined}
                      onClick={() => void act("/requery", undefined, "Đã truy vấn lại SePay.")}
                      className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                      {busy ? "Đang xử lý…" : "Truy vấn lại SePay"}
                    </button>
                  </div>

                  {selected.status === "OPEN" ? (
                    <div className="space-y-3">
                      <p className="font-semibold">Ghi nhận cách xử lý</p>
                      {!canManage && <p className="text-amber-700">Bạn chỉ có quyền xem. Cần quyền payment.manage để xử lý.</p>}
                      <div>
                        <label htmlFor="r-resolution" className="font-semibold">Kết quả</label>
                        <select id="r-resolution" value={resolution} onChange={e => setResolution(e.target.value as "RESOLVED" | "DISMISSED")} disabled={!canManage || busy}
                          className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-3">
                          <option value="RESOLVED">Đã xử lý (hoàn tiền / liên hệ khách / khớp thủ công)</option>
                          <option value="DISMISSED">Bỏ qua (không phải khoản của chúng ta)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="r-note" className="font-semibold">Ghi chú (bắt buộc)</label>
                        <textarea id="r-note" rows={3} value={note} onChange={e => setNote(e.target.value)} disabled={!canManage || busy}
                          className="mt-1 block w-full rounded-xl border border-slate-300 p-3" />
                      </div>
                      <button type="button" disabled={!canManage || busy} onClick={submitResolution}
                        className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                        Lưu xử lý
                      </button>
                      <p className="text-xs text-slate-500">Thao tác này chỉ ghi nhận quyết định và lưu nhật ký. Nó không đổi trạng thái đơn hàng.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="font-semibold">{statusLabel(selected.status)} · {when(selected.resolvedAt)}</p>
                      <p className="mt-1 whitespace-pre-wrap text-slate-700">{selected.resolutionNote}</p>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}

        {data && !error && data.totalPages > 1 && (
          <nav aria-label="Phân trang đối soát" className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">← Trang trước</button>
            <span className="text-sm text-slate-600">Trang {page} / {pageCount} · {RECONCILIATION_PAGE_SIZE}/trang</span>
            <button type="button" disabled={page >= pageCount || loading} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Trang sau →</button>
          </nav>
        )}
      </section>
    </main>
  );
}
