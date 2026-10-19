"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { Button, Card } from "@nexus/ui";

export default function AccountPage() {
  const { user, logout } = useAuth();
  const name = user?.profile?.displayName || "Khách hàng";

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-3xl">
          <header>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Thông tin cá nhân</h1>
            <p className="mt-1 text-sm text-slate-500">Thông tin tài khoản dùng để đăng nhập và nhận hóa đơn.</p>
          </header>

          <Card title="Hồ sơ" subtitle="Thông tin do hệ thống xác thực">
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
                <div aria-hidden="true" className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0037b0] to-cyan-500 text-white flex items-center justify-center font-black text-xl shadow-md">
                  {name[0]?.toUpperCase() || "K"}
                </div>
                <div>
                  <h2 className="font-bold text-base text-slate-900">{name}</h2>
                  <p className="text-sm text-slate-500">{user?.email}</p>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Họ và tên</dt>
                  <dd className="font-semibold text-slate-800">{user?.profile?.displayName || "—"}</dd>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Email</dt>
                  <dd className="font-semibold text-slate-800 break-all">{user?.email || "—"}</dd>
                </div>
              </dl>

              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Mô phỏng — chưa có API cập nhật hồ sơ. Hiện bạn chưa thể sửa họ tên hoặc email tại đây.
              </p>

              <div className="pt-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-3">
                <Link href="/account/security" className="text-sm font-semibold text-[#0037b0] hover:underline">
                  Đổi mật khẩu và bảo mật tài khoản →
                </Link>
                <Button variant="outline" size="sm" onClick={logout} className="text-red-600 border-red-200 hover:bg-red-50">
                  Đăng xuất
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
