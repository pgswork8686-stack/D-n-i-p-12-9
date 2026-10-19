"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/auth-context";
import { Badge, Button } from "@nexus/ui";

type FeatureKey = "hosting" | "membership" | "affiliate" | "finance" | "services";

const NAV_ITEMS: { label: string; href: string; icon: string; feature?: FeatureKey }[] = [
  // Order and wording follow the Figma sidebar (PT01–PT14); gated modules stay hidden until /v1/features enables them.
  { label: "Tổng quan", href: "/", icon: "📊" },
  { label: "Sản phẩm của tôi", href: "/entitlements", icon: "✨" },
  { label: "Trung tâm tải xuống", href: "/downloads", icon: "⬇️" },
  { label: "License", href: "/licenses", icon: "🔑" },
  { label: "Kích hoạt tên miền", href: "/allocations", icon: "🌐" },
  { label: "Đơn hàng", href: "/orders", icon: "📦" },
  { label: "Hỗ trợ", href: "/tickets", icon: "🎫" },
  { label: "Thông báo", href: "/notifications", icon: "🔔" },
  { label: "Thông tin cá nhân", href: "/account", icon: "👤" },
  { label: "Bảo mật", href: "/account/security", icon: "🔒" },
  { label: "Dịch vụ Hosting", href: "/hosting", icon: "☁️", feature: "hosting" },
  { label: "Đối tác & cộng tác viên", href: "/affiliate", icon: "🤝", feature: "affiliate" },
  { label: "Gói thành viên", href: "/subscription", icon: "👑", feature: "membership" },
  { label: "Hóa đơn & thanh toán", href: "/invoices", icon: "🧾", feature: "finance" },
  { label: "Dự án dịch vụ", href: "/services", icon: "🧩", feature: "services" },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Modules switched off on the backend (GET /v1/features) are hidden; until
  // the flags load, gated items stay hidden rather than flashing in.
  const [features, setFeatures] = useState<Partial<Record<FeatureKey, boolean>>>({});
  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    fetch(`${api}/v1/features`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setFeatures)
      .catch(() => setFeatures({}));
  }, []);
  const navItems = NAV_ITEMS.filter((item) => !item.feature || features[item.feature] === true);

  const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

  return (
    <div className="min-h-screen bg-[#faf8ff] text-slate-800 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#0037b0] text-white flex items-center justify-center font-black text-lg">
              N
            </span>
            <div className="leading-tight">
              <span className="font-extrabold text-[#0037b0] tracking-tight block">
                NEXUSTHEME
              </span>
              <span className="text-[11px] font-medium text-slate-400 block uppercase tracking-wider">
                Tài khoản khách hàng
              </span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-[#0037b0] font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-3">
          <a
            href={WEB_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-500 hover:text-[#0037b0] hover:bg-slate-50 rounded-lg transition"
          >
            <span>Cửa hàng</span>
            <span>↗</span>
          </a>
          {user && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
              <div className="font-semibold text-slate-800 truncate">
                {user.profile?.displayName || user.email}
              </div>
              <div className="text-slate-400 truncate">{user.email}</div>
              <div className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="w-full text-xs text-red-600 hover:bg-red-50"
                >
                  Đăng xuất
                </Button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#0037b0] text-white flex items-center justify-center font-black text-sm">
              N
            </span>
            <span className="font-extrabold text-[#0037b0] text-sm">
              NEXUSTHEME · Cổng khách hàng
            </span>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Mở hoặc đóng menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={
                  mobileMenuOpen
                    ? "M6 18L18 6M6 6l12 12"
                    : "M4 6h16M4 12h16M4 18h16"
                }
              />
            </svg>
          </button>
        </header>

        {/* Mobile Menu Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 p-4 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
            <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
              <span className="text-xs text-slate-500 truncate">
                {user?.email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout();
                  setMobileMenuOpen(false);
                }}
                className="text-xs text-red-600"
              >
                Đăng xuất
              </Button>
            </div>
          </div>
        )}

        {/* Desktop top bar (Figma): back to the store, notifications, account */}
        <div className="hidden md:flex items-center justify-end gap-5 border-b border-slate-200 bg-white px-8 py-3 text-sm">
          <a href={WEB_URL} target="_blank" rel="noreferrer" className="font-medium text-slate-600 hover:text-[#0037b0]">
            Về cửa hàng ↗
          </a>
          <Link href="/notifications" aria-label="Thông báo" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
            🔔
          </Link>
          {user && (
            <Link href="/account" className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">
                {(user.profile?.displayName || user.email || "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="leading-tight">
                <span className="block font-semibold text-slate-900">{user.profile?.displayName || user.email}</span>
                <span className="block text-xs text-slate-500">{user.email}</span>
              </span>
            </Link>
          )}
        </div>

        {/* Content Body */}
        <main className="flex-1 p-6 md:p-8 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
