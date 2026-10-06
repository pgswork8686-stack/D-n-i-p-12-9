"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { Logo } from "./logo";

const NAV = [
  { href: "/products", label: "Sản phẩm" },
  { href: "/products?productType=LICENSED_SOFTWARE", label: "Plugin & phần mềm" },
  { href: "/products?productType=DOWNLOADABLE_ASSET", label: "Theme & UI Kit" },
  { href: "/blog", label: "Blog" },
];

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

export function SiteHeader() {
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const count = cart?.itemCount ?? 0;
  const onAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/register");
  const loginHref = onAuthPage ? "/login" : `/login?next=${encodeURIComponent(pathname || "/")}`;

  useEffect(() => setOpen(false), [pathname]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/products?search=${encodeURIComponent(q)}` : "/products");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <div className="container-site flex h-16 items-center gap-4">
        <Logo />

        <nav aria-label="Điều hướng chính" className="ml-4 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form onSubmit={submitSearch} role="search" className="ml-auto hidden max-w-xs flex-1 md:block">
          <label htmlFor="site-search" className="sr-only">
            Tìm sản phẩm
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="site-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theme, plugin…"
              className="field-input min-h-[40px] pl-9 text-sm"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Link
            href="/cart"
            aria-label={`Giỏ hàng, ${count} sản phẩm`}
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink transition-colors hover:bg-brand-soft"
          >
            <ShoppingBag aria-hidden className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute right-1 top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-cta px-1 text-xs font-bold text-white">
                {count}
              </span>
            )}
          </Link>

          {user ? (
            <div className="hidden items-center gap-1 sm:flex">
              <a href={PORTAL_URL} className="btn-ghost min-h-[40px] px-3">
                <User aria-hidden className="h-4 w-4" />
                Tài khoản
              </a>
              <button
                type="button"
                onClick={() => void logout()}
                aria-label="Đăng xuất"
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-brand-soft hover:text-ink"
              >
                <LogOut aria-hidden className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <Link href={loginHref} className="btn-primary hidden min-h-[40px] sm:inline-flex">
              Đăng nhập
            </Link>
          )}

          <button
            type="button"
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-ink hover:bg-brand-soft lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Đóng menu" : "Mở menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-line bg-surface lg:hidden">
          <div className="container-site space-y-1 py-3">
            <form onSubmit={submitSearch} role="search" className="pb-2 md:hidden">
              <label htmlFor="mobile-search" className="sr-only">
                Tìm sản phẩm
              </label>
              <input
                id="mobile-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm theme, plugin…"
                className="field-input"
              />
            </form>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-3 font-medium text-ink hover:bg-brand-soft">
                {item.label}
              </Link>
            ))}
            {user ? (
              <>
                <a href={PORTAL_URL} className="block rounded-lg px-3 py-3 font-medium text-ink hover:bg-brand-soft">
                  Tài khoản của tôi
                </a>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="block w-full cursor-pointer rounded-lg px-3 py-3 text-left font-medium text-muted hover:bg-brand-soft"
                >
                  Đăng xuất
                </button>
              </>
            ) : (
              <Link href="/login" className="btn-primary mt-2 w-full">
                Đăng nhập
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
