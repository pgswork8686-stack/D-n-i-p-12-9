"use client";

import { useState } from "react";
import Link from "next/link";
import type { EntitlementDto, EntitlementStatus } from "@nexus/contracts";
import { Badge } from "@nexus/ui";
import { useAuth } from "../../context/auth-context";
import { AdminApiError, adminFetch } from "../../lib/admin-http";
import { useCan } from "../../lib/permissions";
import { useAdminQuery } from "../../lib/use-admin-query";
import {
  ADMIN_ENTITLEMENT_PAGE_SIZE,
  ADMIN_ENTITLEMENT_STATUSES,
  ADMIN_FULFILLMENT_TYPES,
  adminEntitlementQuery,
  adminEntitlementStatusLabel,
  adminFulfillmentLabel,
  parseAdminEntitlementPage,
  validateRevokeReason,
} from "../../lib/admin-entitlements";

const fmt = (value?: string | null) => (value ? new Date(value).toLocaleDateString("vi-VN") : "—");

export default function AdminEntitlementsPage() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can("entitlement.manage");
  const [status, setStatus] = useState<EntitlementStatus | "">("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, signedIn, reload } = useAdminQuery(
    "/admin/entitlements?" + adminEntitlementQuery(page, status, type),
    "quyền sử dụng",
    parseAdminEntitlementPage,
  );
  const [target, setTarget] = useState<EntitlementDto | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const revoke = async () => {
    if (!token || !target) return;
    const problem = validateRevokeReason(reason);
    if (problem) { setNotice({ tone: "error", text: problem }); return; }
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch("/admin/entitlements/" + encodeURIComponent(target.id) + "/revoke", token, "quyền sử dụng", {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setNotice({ tone: "ok", text: "Đã thu hồi quyền sử dụng. Khách hàng sẽ mất quyền tải và license liên quan." });
      setTarget(null);
      setReason("");
      reload();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof AdminApiError ? cause.message : "Không thu hồi được quyền sử dụng." });
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const pageCount = data?.totalPages ?? 1;

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">Quyền sử dụng (Entitlement)</h1>
          <p className="mt-2 text-sm text-slate-600">Mỗi mặt hàng đã thanh toán sinh đúng một quyền sử dụng. Thu hồi là thao tác không hoàn tác.</p>
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
          <label htmlFor="e-status" className="text-sm font-semibold">Trạng thái</label>
          <select id="e-status" value={status} onChange={e => { setPage(1); setStatus(e.target.value as EntitlementStatus | ""); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
            {ADMIN_ENTITLEMENT_STATUSES.map(s => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="e-type" className="text-sm font-semibold">Loại cấp quyền</label>
          <select id="e-type" value={type} onChange={e => { setPage(1); setType(e.target.value); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
            {ADMIN_FULFILLMENT_TYPES.map(s => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {data && <p role="status" className="text-sm text-slate-600 sm:col-span-2">Có {data.total} quyền sử dụng phù hợp · Trang {page} / {pageCount}</p>}
      </section>

      {target && (
        <section role="dialog" aria-modal="true" aria-labelledby="revoke-title" className="mt-6 rounded-2xl border-2 border-red-300 bg-white p-6">
          <h2 id="revoke-title" className="text-lg font-bold">Thu hồi quyền sử dụng?</h2>
          <p className="mt-2 text-sm text-slate-700">
            Khách (ID <span className="font-mono">{target.userId}</span>) sẽ mất quyền tải và license liên quan. Thao tác không hoàn tác.
          </p>
          <label htmlFor="revoke-reason" className="mt-4 block text-sm font-semibold">Lý do (bắt buộc)</label>
          <textarea id="revoke-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} disabled={busy}
            className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm" />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => { setTarget(null); setReason(""); }} disabled={busy}
              className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold hover:bg-slate-100">Hủy</button>
            <button type="button" onClick={() => void revoke()} disabled={busy}
              className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang thu hồi…" : "Thu hồi"}</button>
          </div>
        </section>
      )}

      <section aria-label="Danh sách quyền sử dụng" className="mt-6">
        {loading ? (
          <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải quyền sử dụng…</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={reload} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
            {!signedIn && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center">
            <p className="font-semibold">Không có quyền sử dụng phù hợp</p>
            <p className="mt-2 text-sm text-slate-500">Thử đổi bộ lọc.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-5 py-4">Khách (ID)</th>
                  <th scope="col" className="px-5 py-4">Loại cấp quyền</th>
                  <th scope="col" className="px-5 py-4">Trạng thái</th>
                  <th scope="col" className="px-5 py-4">Hiệu lực đến</th>
                  <th scope="col" className="px-5 py-4">Đơn</th>
                  <th scope="col" className="px-5 py-4"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-mono text-xs text-slate-700">{item.userId}</td>
                    <td className="px-5 py-4">{adminFulfillmentLabel(item.fulfillmentType)}</td>
                    <td className="px-5 py-4">
                      <Badge variant={item.status === "ACTIVE" ? "success" : item.status === "REVOKED" ? "error" : "warning"}>
                        {adminEntitlementStatusLabel(item.status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{item.expiresAt ? fmt(item.expiresAt) : "Trọn đời"}</td>
                    <td className="px-5 py-4"><Link className="font-mono text-xs text-blue-700 hover:underline" href={`/admin/orders/${item.orderId}`}>{item.orderId}</Link></td>
                    <td className="px-5 py-4 text-right">
                      <button type="button" disabled={!canManage || item.status !== "ACTIVE" || busy}
                        title={!canManage ? "Cần quyền quản lý quyền sử dụng" : item.status !== "ACTIVE" ? "Chỉ thu hồi được quyền đang hoạt động" : undefined}
                        onClick={() => { setNotice(null); setTarget(item); }}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                        Thu hồi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && !error && data.totalPages > 1 && (
          <nav aria-label="Phân trang quyền sử dụng" className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">← Trang trước</button>
            <span className="text-sm text-slate-600">Trang {page} / {pageCount} · {ADMIN_ENTITLEMENT_PAGE_SIZE}/trang</span>
            <button type="button" disabled={page >= pageCount || loading} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Trang sau →</button>
          </nav>
        )}
      </section>
    </main>
  );
}
