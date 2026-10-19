"use client";

import { useState } from "react";
import Link from "next/link";
import type { LicenseAllocationDto } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { AdminApiError, adminFetch } from "../../lib/admin-http";
import { useCan } from "../../lib/permissions";
import { useAdminQuery } from "../../lib/use-admin-query";
import {
  accountUsagePercent,
  accountUsedCount,
  activatableAccounts,
  adminAllocationQuery,
  allocationRequestLabel,
  parseAdminAllocationPage,
  parseProviderAccounts,
  parseProviders,
  providerName,
  validateRejectReason,
} from "../../lib/admin-allocations";

type Action = { kind: "activate" | "reject" | "confirm"; row: LicenseAllocationDto };
const fmt = (value?: string | null) => (value ? new Date(value).toLocaleString("vi-VN") : "—");

export default function AdminLicenseAllocationsPage() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can("license.manage");
  const pending = useAdminQuery("/admin/license-allocations?" + adminAllocationQuery("PENDING"), "yêu cầu kích hoạt", parseAdminAllocationPage);
  const deact = useAdminQuery("/admin/license-allocations?" + adminAllocationQuery("DEACTIVATION_PENDING"), "yêu cầu hủy kích hoạt", parseAdminAllocationPage);
  const accounts = useAdminQuery("/admin/provider-accounts", "tài khoản nhà cung cấp", parseProviderAccounts);
  const providers = useAdminQuery("/admin/license-providers", "nhà cung cấp", parseProviders);
  const [action, setAction] = useState<Action | null>(null);
  const [accountId, setAccountId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const reloadAll = () => { pending.reload(); deact.reload(); accounts.reload(); providers.reload(); };
  const rows = [...(pending.data?.items ?? []), ...(deact.data?.items ?? [])];
  const loading = pending.loading || deact.loading;
  const error = pending.error ?? deact.error;
  const open = (kind: Action["kind"], row: LicenseAllocationDto) => { setNotice(null); setText(""); setAccountId(""); setAction({ kind, row }); };
  const options = action ? activatableAccounts(accounts.data ?? [], action.row.providerId) : [];

  const submit = async () => {
    if (!token || !action) return;
    const { kind, row } = action;
    const base = "/admin/license-allocations/" + encodeURIComponent(row.id);
    let path = "", body: Record<string, string> = {}, ok = "";
    if (kind === "activate") {
      if (!accountId) { setNotice({ tone: "error", text: "Chọn tài khoản nhà cung cấp còn dung lượng." }); return; }
      path = base + "/activate"; body = { providerAccountId: accountId, ...(text.trim() ? { notes: text.trim() } : {}) };
      ok = "Đã xác nhận kích hoạt tên miền. Khách sẽ thấy trạng thái Hoạt động.";
    } else if (kind === "reject") {
      const problem = validateRejectReason(text);
      if (problem) { setNotice({ tone: "error", text: problem }); return; }
      path = base + "/reject"; body = { reason: text.trim() }; ok = "Đã từ chối yêu cầu kích hoạt.";
    } else {
      path = base + "/confirm-deactivated"; body = text.trim() ? { notes: text.trim() } : {}; ok = "Đã xác nhận gỡ tên miền trên nhà cung cấp.";
    }
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch(path, token, "yêu cầu license", { method: "POST", body: JSON.stringify(body) });
      setNotice({ tone: "ok", text: ok });
      setAction(null);
      reloadAll();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof AdminApiError ? cause.message : "Thao tác không thành công." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">License quản lý hộ</h1>
          <p className="mt-2 text-sm text-slate-600">Xử lý tên miền trên tài khoản nhà cung cấp, sau đó xác nhận tại đây. Không lưu hay hiển thị master key.</p>
        </div>
        <button type="button" onClick={reloadAll} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Tải lại</button>
      </header>

      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"}
          className={"mt-5 rounded-xl border p-4 text-sm " + (notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
          {notice.text}
        </div>
      )}

      <section aria-label="Dung lượng nhà cung cấp" className="mt-6">
        {accounts.loading ? (
          <div role="status" className="rounded-2xl border bg-white p-6 text-sm text-slate-600">Đang tải dung lượng…</div>
        ) : accounts.error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{accounts.error}</div>
        ) : (accounts.data ?? []).length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">Chưa có tài khoản nhà cung cấp.</div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-3">
            {(accounts.data ?? []).map(account => (
              <li key={account.id} className="rounded-2xl border bg-white p-5">
                <p className="font-semibold">{providerName(providers.data ?? [], account.providerId)} — {account.name}</p>
                <div className="mt-3 h-2 rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={accountUsagePercent(account)}>
                  <div className="h-2 rounded-full bg-blue-600" style={{ width: accountUsagePercent(account) + "%" }} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{accountUsedCount(account)} / {account.totalCapacity} tên miền đang dùng{account.status !== "ACTIVE" ? " · " + account.status : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {action && (
        <section role="dialog" aria-modal="true" aria-labelledby="alloc-title" className="mt-6 rounded-2xl border-2 border-blue-300 bg-white p-6">
          <h2 id="alloc-title" className="text-lg font-bold">
            {action.kind === "activate" ? "Xác nhận kích hoạt" : action.kind === "reject" ? "Từ chối yêu cầu" : "Xác nhận đã gỡ trên nhà cung cấp"} — {action.row.domain}
          </h2>
          {action.kind === "activate" && (
            <>
              <label htmlFor="a-account" className="mt-4 block text-sm font-semibold">Tài khoản nhà cung cấp</label>
              <select id="a-account" value={accountId} onChange={e => setAccountId(e.target.value)} disabled={busy}
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
                <option value="">— Chọn tài khoản còn dung lượng —</option>
                {options.map(a => <option key={a.id} value={a.id}>{a.name} ({accountUsedCount(a)}/{a.totalCapacity})</option>)}
              </select>
              {options.length === 0 && <p className="mt-2 text-xs text-red-700">Không có tài khoản nào còn dung lượng cho nhà cung cấp này.</p>}
            </>
          )}
          <label htmlFor="a-text" className="mt-4 block text-sm font-semibold">{action.kind === "reject" ? "Lý do (bắt buộc)" : "Ghi chú (không bắt buộc)"}</label>
          <textarea id="a-text" value={text} onChange={e => setText(e.target.value)} rows={3} disabled={busy}
            className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm" />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => setAction(null)} disabled={busy} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold hover:bg-slate-100">Hủy</button>
            <button type="button" onClick={() => void submit()} disabled={busy}
              className={"rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 " + (action.kind === "reject" ? "bg-red-600" : "bg-blue-600")}>
              {busy ? "Đang xử lý…" : action.kind === "reject" ? "Từ chối" : "Xác nhận"}
            </button>
          </div>
        </section>
      )}

      <section aria-label="Chờ xử lý" className="mt-6 rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">Chờ xử lý <span className="ml-2 text-sm font-normal text-amber-700">{rows.length} yêu cầu</span></h2>
        {loading ? (
          <p role="status" className="mt-4 text-sm text-slate-600">Đang tải yêu cầu…</p>
        ) : error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={reloadAll} className="mt-2 rounded-lg border border-red-300 px-4 py-2 font-semibold">Thử lại</button>
            {!pending.signedIn && <Link href="/login" className="ml-4 font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Không có yêu cầu nào đang chờ.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b text-slate-600">
                <tr>
                  <th scope="col" className="py-3 pr-4">Tên miền</th>
                  <th scope="col" className="py-3 pr-4">Khách (ID)</th>
                  <th scope="col" className="py-3 pr-4">Loại yêu cầu</th>
                  <th scope="col" className="py-3 pr-4">Nhà cung cấp</th>
                  <th scope="col" className="py-3 pr-4">Gửi lúc</th>
                  <th scope="col" className="py-3"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="py-3 pr-4 font-semibold">{row.domain}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-600">{row.userId}</td>
                    <td className="py-3 pr-4">{allocationRequestLabel(row.status)}</td>
                    <td className="py-3 pr-4">{providerName(providers.data ?? [], row.providerId)}</td>
                    <td className="py-3 pr-4 text-slate-600">{fmt(row.requestedAt)}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {row.status === "PENDING" ? (
                          <>
                            <button type="button" disabled={!canManage || busy} onClick={() => open("reject", row)}
                              className="rounded-lg border border-slate-300 px-3 py-2 font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Từ chối</button>
                            <button type="button" disabled={!canManage || busy} onClick={() => open("activate", row)}
                              className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Xác nhận</button>
                          </>
                        ) : (
                          <button type="button" disabled={!canManage || busy} onClick={() => open("confirm", row)}
                            className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Đã gỡ trên nhà cung cấp</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!canManage && <p className="mt-3 text-xs text-red-700">Cần quyền quản lý license để xử lý yêu cầu.</p>}
          </div>
        )}
      </section>

      <aside role="note" className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
        <p className="font-semibold">Quy trình</p>
        <p className="mt-1">Khách gửi tên miền → Chờ quản trị viên → nhân viên thêm tên miền trên trang nhà cung cấp → bấm Xác nhận → khách thấy Hoạt động.</p>
      </aside>
    </main>
  );
}
