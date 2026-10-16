"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/auth-context";
import { getApiUrl } from "./lib/api";
import { visibleAdminNavigation } from "./lib/admin-navigation";

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

type CountState = { status: "idle" | "loading" | "success" | "error"; value?: number };

export default function AdminHomePage() {
  const { token, user, isLoading, isConnectivityError, logout } = useAuth();
  const nav = useMemo(
    () => visibleAdminNavigation(user?.permissions ?? [], user?.roles ?? []),
    [user?.permissions, user?.roles],
  );
  const canReadOrders = nav.some(item => item.permission === "order.read");
  const [count, setCount] = useState<CountState>({ status: "idle" });

  // Only display a metric when the API supplies an authoritative total.
  useEffect(() => {
    if (isLoading || !token || !canReadOrders) {
      setCount({ status: "idle" });
      return;
    }
    let canceled = false;
    setCount({ status: "loading" });
    (async () => {
      try {
        const response = await fetch(getApiUrl() + "/admin/orders?page=1&limit=1", {
          headers: { Authorization: "Bearer " + token }, cache: "no-store",
        });
        if (!response.ok) throw new Error("Order summary unavailable");
        const data = await response.json() as { total?: unknown };
        if (!Number.isSafeInteger(data.total) || Number(data.total) < 0) {
          throw new Error("Order response missing authoritative total");
        }
        if (!canceled) setCount({ status: "success", value: Number(data.total) });
      } catch {
        if (!canceled) setCount({ status: "error" });
      }
    })();
    return () => { canceled = true; };
  }, [isLoading, token, canReadOrders]);

  return (
    <main id="main" className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">NEXUSTHEME · ADMIN</p>
            <h1 className="mt-2 text-3xl font-bold">Tổng quan quản trị</h1>
            <p className="mt-2 text-sm text-slate-600">Quản lý sản phẩm, đơn hàng, nội dung và vận hành theo quyền tài khoản.</p>
          </div>
          <div className="flex items-center gap-3">
            {token && user ? <button onClick={() => void logout()} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Đăng xuất</button> :
              <Link href="/login" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Đăng nhập</Link>}
          </div>
        </header>
        {isLoading ? (
          <p role="status" className="rounded-xl border bg-white p-6">Đang xác minh phiên quản trị…</p>
        ) : !token || !user ? (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="font-semibold">Chưa có phiên đăng nhập hợp lệ</h2>
            <p className="mt-2 text-sm">Vui lòng đăng nhập bằng tài khoản quản trị đã được cấp quyền.</p>
            {isConnectivityError && <p className="mt-2 text-sm">Máy chủ tạm thời không phản hồi. Hãy thử lại sau.</p>}
          </div>
        ) : nav.length === 0 ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6">
            <h2 className="font-semibold">Không đủ quyền truy cập</h2>
            <p className="mt-2 text-sm">Tài khoản đã đăng nhập nhưng chưa có quyền vận hành Admin.</p>
          </div>
        ) : (
          <>
            <section aria-label="Tài khoản đang đăng nhập" className="rounded-2xl border bg-white p-5">
              <p className="text-sm text-slate-500">Tài khoản</p>
              <p className="mt-1 font-semibold">{user.profile?.displayName || user.email}</p>
              <p className="mt-2 text-xs text-slate-500">Quyền điều hướng theo /auth/me; mọi endpoint tiếp tục kiểm tra RBAC trên máy chủ.</p>
            </section>
            {canReadOrders && (
              <section aria-label="Số liệu đơn hàng" className="rounded-2xl border bg-white p-6">
                <p className="text-sm text-slate-500">Tổng số đơn hàng đã ghi nhận</p>
                {count.status === "success" ? <p className="mt-2 text-3xl font-bold">{count.value}</p> :
                  count.status === "loading" ? <p role="status" className="mt-2 text-sm">Đang tải số liệu…</p> :
                  <p className="mt-2 text-sm text-slate-500">Chưa tải được số liệu, không hiển thị số ước đoán.</p>}
                <Link className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline" href="/admin/orders">Xem đơn hàng →</Link>
              </section>
            )}
            <section aria-labelledby="admin-modules-title">
              <h2 id="admin-modules-title" className="text-lg font-bold">Chức năng được phép sử dụng</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {nav.map(item => <Link key={item.href} href={item.href}
                  className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-blue-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <span className="font-bold">{item.label}</span>
                  <span className="mt-2 block text-sm text-blue-700">Mở chức năng →</span>
                </Link>)}
              </div>
            </section>
          </>
        )}
        <footer className="flex flex-wrap gap-5 border-t pt-5 text-sm text-slate-600">
          <a href={WEB_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">Cửa hàng ↗</a>
          <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">Cổng khách hàng ↗</a>
        </footer>
      </div>
    </main>
  );
}
