"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminUserListItem } from "@nexus/contracts";
import { useAdminQuery } from "../../lib/use-admin-query";
import {
  ADMIN_USER_PAGE_SIZE,
  adminUserDisplayName,
  adminUserInitials,
  allAdminRoles,
  parseAdminUsers,
  viewAdminUsers,
} from "../../lib/admin-users";

const fmt = (value?: string | null) => (value ? new Date(value).toLocaleString("vi-VN") : "—");

export default function AdminUsersPage() {
  const { data, loading, error, signedIn, reload } = useAdminQuery("/admin/users", "danh sách khách hàng", parseAdminUsers);
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const users = data ?? [];
  const view = viewAdminUsers(users, role, search, page);
  const selected: AdminUserListItem | null = users.find(user => user.id === selectedId) ?? view.items[0] ?? null;

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Tổng quan</Link>
          <h1 className="mt-3 text-3xl font-bold">Khách hàng</h1>
          <p className="mt-2 text-sm text-slate-600">Trang chỉ có quyền xem. Việc gán hoặc gỡ vai trò đang bị khóa.</p>
        </div>
        <button type="button" onClick={reload} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Tải lại</button>
      </header>

      <section aria-label="Bộ lọc" className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-[1fr_220px]">
        <div>
          <label htmlFor="u-search" className="text-sm font-semibold">Tìm theo tên hoặc email</label>
          <input id="u-search" value={search} onChange={e => { setPage(1); setSearch(e.target.value); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm" />
        </div>
        <div>
          <label htmlFor="u-role" className="text-sm font-semibold">Vai trò</label>
          <select id="u-role" value={role} onChange={e => { setPage(1); setRole(e.target.value); }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm">
            <option value="">Tất cả</option>
            {allAdminRoles(users).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {data && <p role="status" className="text-sm text-slate-600 sm:col-span-2">Có {view.total} người dùng phù hợp · Trang {view.page} / {view.totalPages}</p>}
      </section>

      <section aria-label="Danh sách khách hàng" className="mt-6">
        {loading ? (
          <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải khách hàng…</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
            <p className="font-semibold">{error}</p>
            <button type="button" onClick={reload} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
            {!signedIn && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
          </div>
        ) : view.items.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center">
            <p className="font-semibold">Không có người dùng phù hợp</p>
            <p className="mt-2 text-sm text-slate-500">Thử đổi bộ lọc hoặc từ khóa.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-5 py-4">Khách hàng</th>
                    <th scope="col" className="px-5 py-4">Vai trò</th>
                    <th scope="col" className="px-5 py-4">Tham gia</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {view.items.map(user => (
                    <tr key={user.id} className={selected?.id === user.id ? "bg-blue-50" : "hover:bg-slate-50"}>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => setSelectedId(user.id)} aria-current={selected?.id === user.id} className="flex items-center gap-3 text-left">
                          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{adminUserInitials(user)}</span>
                          <span><span className="block font-semibold">{adminUserDisplayName(user)}</span><span className="block text-xs text-slate-500">{user.email ?? "Chưa có email"}</span></span>
                        </button>
                      </td>
                      <td className="px-5 py-4">{user.roles.length ? user.roles.join(", ") : "—"}</td>
                      <td className="px-5 py-4 text-slate-600">{new Date(user.createdAt).toLocaleDateString("vi-VN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected && (
              <aside aria-label="Chi tiết khách hàng" className="rounded-2xl border bg-white p-5 text-sm">
                <h2 className="text-lg font-bold">{adminUserDisplayName(selected)}</h2>
                <p className="text-slate-500">{selected.email ?? "Chưa có email"}</p>
                <dl className="mt-4 space-y-2">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">ID</dt><dd className="font-mono text-xs">{selected.id}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Tham gia</dt><dd>{fmt(selected.createdAt)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Cập nhật</dt><dd>{fmt(selected.updatedAt)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Vai trò</dt><dd>{selected.roles.join(", ") || "—"}</dd></div>
                </dl>
                <div role="note" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="font-semibold">Gán vai trò đang khóa</p>
                  <p className="mt-1">Chờ xác nhận ai được quyền đổi vai trò (user.manage). Không thay đổi RBAC trong bản này.</p>
                </div>
                <p className="mt-3 text-xs text-slate-500">Đơn hàng, quyền sử dụng và ticket của khách xem ở các trang tương ứng; API quản trị chưa trả số liệu tổng hợp theo khách.</p>
              </aside>
            )}
          </div>
        )}

        {data && !error && view.totalPages > 1 && (
          <nav aria-label="Phân trang khách hàng" className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">← Trang trước</button>
            <span className="text-sm text-slate-600">Trang {view.page} / {view.totalPages} · {ADMIN_USER_PAGE_SIZE}/trang</span>
            <button type="button" disabled={view.page >= view.totalPages} onClick={() => setPage(view.page + 1)}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Trang sau →</button>
          </nav>
        )}
      </section>
    </main>
  );
}
