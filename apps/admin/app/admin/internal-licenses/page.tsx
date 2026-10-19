"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminLicenseDto, AdminLicenseRevokeReason, LicenseStatus } from "@nexus/contracts";
import { Badge } from "@nexus/ui";
import { useAuth } from "../../context/auth-context";
import { AdminApiError, adminFetch } from "../../lib/admin-http";
import { confirmAction, useCan } from "../../lib/permissions";
import { useAdminQuery } from "../../lib/use-admin-query";
import {
  ADMIN_LICENSE_PAGE_SIZE,
  ADMIN_LICENSE_REVOKE_REASONS,
  ADMIN_LICENSE_STATUSES,
  adminLicenseStatusLabel,
  isRevokeReason,
  maskedLicenseKey,
  parseAdminLicenseList,
  viewAdminLicenses,
} from "../../lib/admin-licenses";

const fmt = (value?: string | null) => (value ? new Date(value).toLocaleString("vi-VN") : "—");

export default function AdminInternalLicensesPage() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can("license.manage");
  const { data, loading, error, signedIn, reload } = useAdminQuery("/admin/internal-licenses", "license nội bộ", parseAdminLicenseList);
  const [status, setStatus] = useState<LicenseStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState<AdminLicenseRevokeReason>("ADMINISTRATIVE");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const view = viewAdminLicenses(data ?? [], status, search, page);
  const selected: AdminLicenseDto | null = (data ?? []).find(item => item.id === selectedId) ?? view.items[0] ?? null;

  const revoke = async () => {
    if (!token || !selected) return;
    if (!confirmAction("Thu hồi license " + maskedLicenseKey(selected.keyLast4) + "? Các tên miền đang dùng sẽ không còn hợp lệ. Thao tác không hoàn tác.")) return;
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch("/admin/internal-licenses/" + encodeURIComponent(selected.id) + "/revoke", token, "license", {
        method: "POST",
        body: JSON.stringify({ reasonCode: reason }),
      });
      setNotice({ tone: "ok", text: "Đã thu hồi license." });
      reload();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof AdminApiError ? cause.message : "Không thu hồi được license." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">License nội bộ</h1>
          <p className="mt-2 text-sm text-slate-600">Key luôn hiển thị dạng che trong quản trị. Không ghi key vào nhật ký.</p>
        </div>
        <button type="button" onClick={reload} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Tải lại</button>
      </header>

      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"}
          className={"mt-5 rounded-xl border p-4 text-sm " + (notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
          {notice.text}
        </div>
      )}

      <section aria-label="Bộ lọc" className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-[1fr_220px]">
        <div>
          <label htmlFor="l-search" className="text-sm font-semibold">Tìm theo 4 ký tự cuối của key, khách hoặc sản phẩm</label>
          <input id="l-search" value={search} onChange={e => { setPage(1); setSearch(e.target.value); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="VD: 19C4" />
        </div>
        <div>
          <label htmlFor="l-status" className="text-sm font-semibold">Trạng thái</label>
          <select id="l-status" value={status} onChange={e => { setPage(1); setStatus(e.target.value as LicenseStatus | ""); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
            {ADMIN_LICENSE_STATUSES.map(s => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {data && <p role="status" className="text-sm text-slate-600 sm:col-span-2">Có {view.total} license phù hợp · Trang {view.page} / {view.totalPages}</p>}
      </section>

      <section aria-label="License nội bộ" className="mt-6">
        {loading ? (
          <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải license…</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={reload} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
            {!signedIn && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : view.items.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center">
            <p className="font-semibold">Không có license phù hợp</p>
            <p className="mt-2 text-sm text-slate-500">Thử đổi bộ lọc hoặc từ khóa.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-5 py-4">Key</th>
                    <th scope="col" className="px-5 py-4">Khách (ID)</th>
                    <th scope="col" className="px-5 py-4">Tên miền</th>
                    <th scope="col" className="px-5 py-4">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {view.items.map(item => (
                    <tr key={item.id} className={"cursor-pointer hover:bg-slate-50 " + (selected?.id === item.id ? "bg-blue-50" : "")}>
                      <td className="px-5 py-4 font-mono font-semibold">
                        <button type="button" onClick={() => setSelectedId(item.id)} aria-current={selected?.id === item.id} className="text-blue-700 hover:underline">{maskedLicenseKey(item.keyLast4)}</button>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-600">{item.userId}</td>
                      <td className="px-5 py-4">{item.activeActivations} / {item.maxActivations ?? "∞"}</td>
                      <td className="px-5 py-4"><Badge variant={item.status === "ACTIVE" ? "success" : "error"}>{adminLicenseStatusLabel(item.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected && (
              <aside aria-label="Chi tiết license" className="rounded-2xl border bg-white p-5 text-sm">
                <h2 className="font-mono text-lg font-bold">{maskedLicenseKey(selected.keyLast4)}</h2>
                <dl className="mt-4 space-y-2">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Trạng thái</dt><dd>{adminLicenseStatusLabel(selected.status)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Khách (ID)</dt><dd className="font-mono text-xs">{selected.userId}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Quyền sử dụng</dt><dd className="font-mono text-xs">{selected.entitlementId}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Tên miền kích hoạt</dt><dd>{selected.activeActivations} / {selected.maxActivations ?? "không giới hạn"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Tạo lúc</dt><dd>{fmt(selected.createdAt)}</dd></div>
                  {selected.revokedAt && <div className="flex justify-between gap-3"><dt className="text-slate-500">Thu hồi lúc</dt><dd>{fmt(selected.revokedAt)}</dd></div>}
                </dl>
                <p className="mt-3 text-xs text-slate-500">Danh sách tên miền cụ thể chưa được API quản trị trả về nên không hiển thị ở đây.</p>
                <label htmlFor="l-reason" className="mt-5 block text-xs font-semibold text-slate-600">Lý do thu hồi</label>
                <select id="l-reason" value={reason} disabled={!canManage || busy || selected.status !== "ACTIVE"}
                  onChange={e => { if (isRevokeReason(e.target.value)) setReason(e.target.value); }}
                  className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
                  {ADMIN_LICENSE_REVOKE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button type="button" onClick={() => void revoke()} disabled={!canManage || busy || selected.status !== "ACTIVE"}
                  className="mt-4 w-full rounded-xl border border-red-300 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
                  {busy ? "Đang thu hồi…" : "Thu hồi license"}
                </button>
                {!canManage && <p className="mt-2 text-xs text-red-700">Cần quyền quản lý license để thu hồi.</p>}
              </aside>
            )}
          </div>
        )}

        {data && !error && view.totalPages > 1 && (
          <nav aria-label="Phân trang license" className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">← Trang trước</button>
            <span className="text-sm text-slate-600">Trang {view.page} / {view.totalPages} · {ADMIN_LICENSE_PAGE_SIZE}/trang</span>
            <button type="button" disabled={view.page >= view.totalPages} onClick={() => setPage(view.page + 1)}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Trang sau →</button>
          </nav>
        )}
      </section>
    </main>
  );
}
