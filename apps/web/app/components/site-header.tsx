"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { Logo } from "./logo";
import type { NavCategory } from "../lib/home-catalog";

/** Items marked with `feature` stay hidden until GET /v1/features confirms the module is on. */
type NavItem = { href: string; label: string; feature?: "services" };

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

const categoryHref = (slug: string) => `/products?category=${encodeURIComponent(slug)}`;

/**
 * Inline category links from 1280px. The container is capped at 1280px, so
 * wider screens get no extra room: 5 groups fit with real (long) names at any
 * width ≥1280 (measured). Every group is always in the "Sản phẩm" menu.
 */
const INLINE_AT_XL = 5;

export function SiteHeader({ categories = [] }: { categories?: NavCategory[] }) {
  const NAV: NavItem[] = [
    { href: "/products", label: "Sản phẩm" },
    ...categories.map((c) => ({ href: categoryHref(c.slug), label: c.name })),
    { href: "/services", label: "Dịch vụ", feature: "services" },
    { href: "/blog", label: "Blog" },
  ];
  const [productsOpen, setProductsOpen] = useState(false);
  const productsMenuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const count = cart?.itemCount ?? 0;
  const onAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/register");
  const loginHref = onAuthPage ? "/login" : `/login?next=${encodeURIComponent(pathname || "/")}`;

  useEffect(() => {
    setOpen(false);
    setProductsOpen(false);
  }, [pathname]);

  // Products menu: close on Escape (focus back on the button) and on outside click.
  useEffect(() => {
    if (!productsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProductsOpen(false);
        productsMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!productsMenuRef.current?.contains(e.target as Node)) setProductsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [productsOpen]);

  // Feature-flagged items stay hidden until GET /v1/features confirms them.
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  useEffect(() => {
    fetch(`${API_URL}/v1/features`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setFeatures)
      .catch(() => setFeatures({}));
  }, []);
  const navItems = NAV.filter((item) => !item.feature || features[item.feature] === true);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/products?search=${encodeURIComponent(q)}` : "/products");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <div className="container-site flex h-16 items-center gap-4">
        <Logo />

        <nav aria-label="Điều hướng chính" className="ml-2 hidden min-w-0 items-center gap-0.5 lg:flex">
          <div ref={productsMenuRef} className="relative">
            <button
              type="button"
              aria-expanded={productsOpen}
              aria-controls="products-menu"
              onClick={() => setProductsOpen((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${productsOpen ? "bg-brand-soft text-brand" : "text-body hover:bg-brand-soft hover:text-brand"}`}
            >
              Sản phẩm
              <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${productsOpen ? "rotate-180" : ""}`} />
            </button>
            {productsOpen && (
              <div id="products-menu" className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-lift">
                <ul>
                  {categories.map((c) => (
                    <li key={c.slug}>
                      <Link href={categoryHref(c.slug)} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink hover:bg-brand-soft hover:text-brand">
                        {c.name}
                      </Link>
                    </li>
                  ))}
                  <li className="mt-1 border-t border-line pt-1">
                    <Link href="/products" className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-brand hover:bg-brand-soft">
                      Tất cả sản phẩm
                    </Link>
                  </li>
                </ul>
              </div>
            )}
          </div>
          {categories.slice(0, INLINE_AT_XL).map((c) => (
            <Link
              key={c.slug}
              href={categoryHref(c.slug)}
              className="hidden shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-body transition-colors hover:bg-brand-soft hover:text-brand xl:inline-flex"
            >
              {c.name}
            </Link>
          ))}
          {features.services === true && (
            <Link href="/services" className="inline-flex shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-body transition-colors hover:bg-brand-soft hover:text-brand">
              Dịch vụ
            </Link>
          )}
          <Link href="/blog" className="inline-flex shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-body transition-colors hover:bg-brand-soft hover:text-brand">
            Blog
          </Link>
        </nav>

        <form onSubmit={submitSearch} role="search" className="ml-auto hidden max-w-xs flex-1 md:block xl:hidden">
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

        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-2 xl:ml-auto">
          <Link
            href="/products"
            aria-label="Tìm sản phẩm"
            className="hidden h-11 w-11 items-center justify-center rounded-xl text-ink transition-colors hover:bg-brand-soft xl:inline-flex"
          >
            <Search aria-hidden className="h-5 w-5" />
          </Link>
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
            {navItems.map((item) => (
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
