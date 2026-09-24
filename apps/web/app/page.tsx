"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, PriceDisplay, ProductVersionBadge } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

export default function WebHomePage() {
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/products?limit=6&currency=USD`).then((res) => (res.ok ? res.json() : { items: [] })),
      fetch(`${API_URL}/categories`).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([productsRes, catsRes]) => {
        setFeaturedProducts(productsRes.items || []);
        setCategories(catsRes || []);
      })
      .catch((err) => {
        console.error("Failed to load storefront data:", err);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      window.location.href = `/products?search=${encodeURIComponent(searchQuery)}`;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Top Announcement Bar */}
      <div className="bg-[#0037b0] text-white py-2 px-4 text-center text-xs font-medium tracking-wide">
        🚀 Phase 17 Production Storefront Live — Explore 500+ Premium Digital Themes, Plugins & Cloud Hosting
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#0037b0] text-white flex items-center justify-center font-black text-xl shadow-sm">
              N
            </span>
            <div className="leading-tight">
              <span className="font-extrabold text-[#0037b0] text-lg tracking-tight block">
                NEXUSTHEME
              </span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block">
                Digital Marketplace
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-600">
            <Link href="/products" className="hover:text-[#0037b0] transition-colors">
              All Products
            </Link>
            <Link href="/products?productType=LICENSED_SOFTWARE" className="hover:text-[#0037b0] transition-colors">
              Software & Plugins
            </Link>
            <Link href="/products?productType=HOSTING_PROVISIONING" className="hover:text-[#0037b0] transition-colors">
              Cloud Hosting
            </Link>
            <Link href="/blog" className="hover:text-[#0037b0] transition-colors">
              Articles & Guides
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/cart" className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 relative">
              <span className="text-xl">🛒</span>
            </Link>
            <a
              href={PORTAL_URL}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
            >
              <span>👤</span> Customer Hub
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/50 via-white to-slate-50 pt-16 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100/70 text-[#0037b0] text-xs font-bold tracking-wide uppercase">
            <span>✨</span> Enterprise Digital Commerce Platform
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-slate-950 tracking-tight leading-[1.1]">
            Build Faster with Verified <br className="hidden sm:inline" />
            <span className="text-[#0037b0]">Themes, Plugins & Cloud Assets</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Curated digital assets with instant automated licensing, lifetime version updates, and enterprise-grade SLA helpdesk support.
          </p>

          {/* Instant Search Bar */}
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto flex items-center gap-2 p-1.5 bg-white rounded-2xl border-2 border-slate-200/90 shadow-lg shadow-blue-900/5 focus-within:border-[#0037b0] transition-all">
            <span className="pl-3 text-lg text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Search WordPress themes, WooCommerce plugins, templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-2 py-2.5 text-sm bg-transparent outline-none text-slate-900 placeholder-slate-400"
            />
            <button
              type="submit"
              className="px-6 py-2.5 bg-[#0037b0] hover:bg-[#002c8f] text-white rounded-xl text-sm font-bold shadow transition-all shrink-0"
            >
              Search
            </button>
          </form>

          {/* Quick Category Pills */}
          <div className="flex items-center justify-center flex-wrap gap-2 text-xs text-slate-500 pt-2">
            <span className="font-semibold text-slate-400">Trending:</span>
            {categories.slice(0, 5).map((cat) => (
              <Link
                key={cat.id}
                href={`/products?category=${cat.id}`}
                className="px-3 py-1 bg-white hover:bg-blue-50 hover:text-[#0037b0] border border-slate-200 rounded-full font-medium transition-colors"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Value Propositions */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-2">
            <span className="text-3xl">⚡</span>
            <h3 className="font-bold text-slate-900">Instant Fulfillment</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Automated license key generation and signed ZIP download links ready within seconds of payment.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-2">
            <span className="text-3xl">🛡️</span>
            <h3 className="font-bold text-slate-900">100% Virus-Free Code</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Every asset package is scanned with ClamAV and checksum-verified before distribution.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-2">
            <span className="text-3xl">☁️</span>
            <h3 className="font-bold text-slate-900">1-Click Hosting</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Provision high-performance cPanel/DirectAdmin instances with automated Cloudflare DNS sync.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-2">
            <span className="text-3xl">🎫</span>
            <h3 className="font-bold text-slate-900">Priority Helpdesk SLA</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Dedicated technical support tickets directly linked to your orders and license entitlements.
            </p>
          </div>
        </div>
      </section>

      {/* Featured Products Catalog */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
              Featured Digital Products
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Hand-picked best sellers backed by verified ratings and developer documentation.
            </p>
          </div>
          <Link
            href="/products"
            className="text-sm font-bold text-[#0037b0] hover:text-[#002c8f] flex items-center gap-1 group"
          >
            <span>Explore All</span>
            <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-72 rounded-2xl bg-white border border-slate-200 animate-pulse p-6" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredProducts.map((p) => {
              const defaultVariant = p.variants?.[0];
              const defaultPrice = defaultVariant?.prices?.[0];
              const amountMinor = defaultPrice?.amount ?? 4900;
              const compareAt = defaultPrice?.compareAtAmount;

              return (
                <div
                  key={p.id}
                  className="rounded-2xl bg-white border border-slate-200/90 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden group"
                >
                  <div className="h-44 bg-gradient-to-br from-slate-100 to-blue-50/50 flex items-center justify-center relative p-6 border-b border-slate-100">
                    <span className="text-5xl group-hover:scale-105 transition-transform duration-200">
                      📦
                    </span>
                    <div className="absolute top-3 left-3">
                      <ProductVersionBadge version="1.0.0" channel="STABLE" />
                    </div>
                  </div>

                  <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <Link
                        href={`/products/${p.slug}`}
                        className="text-lg font-bold text-slate-900 group-hover:text-[#0037b0] transition-colors block leading-snug"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {p.shortDescription || p.description || "Premium digital asset with automated entitlement access."}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                      <PriceDisplay
                        amountMinor={amountMinor}
                        compareAtMinor={compareAt}
                        currency="USD"
                        size="md"
                      />
                      <Link href={`/products/${p.slug}`}>
                        <Button size="sm" variant="outline">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Membership CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-[#00247d] to-[#0037b0] text-white p-8 sm:p-14 shadow-xl flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="max-w-xl space-y-4 text-center md:text-left">
            <span className="inline-block px-3 py-1 rounded-full bg-blue-400/20 text-blue-200 text-xs font-bold uppercase tracking-wider">
              👑 Unlimited Access Pass
            </span>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
              Get Unlimited Downloads with NexusTheme Pro Membership
            </h2>
            <p className="text-sm sm:text-base text-blue-100/90 leading-relaxed">
              Unlock access to all themes, plugins, high-bandwidth cloud hosting credits, and priority helpdesk support for one predictable subscription fee.
            </p>
          </div>
          <div className="shrink-0">
            <a
              href={`${PORTAL_URL}/subscription`}
              className="inline-flex items-center justify-center px-8 py-4 rounded-2xl bg-white text-slate-900 font-extrabold text-base hover:bg-blue-50 shadow-lg hover:shadow-xl transition-all"
            >
              Explore Membership Plans →
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12 py-12 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 NexusTheme Digital Commerce Ltd. All rights reserved.</p>
          <div className="flex items-center gap-6 font-medium">
            <Link href="/products" className="hover:text-slate-800">
              Catalog
            </Link>
            <a href={`${PORTAL_URL}/tickets`} className="hover:text-slate-800">
              Support Helpdesk
            </a>
            <a href={`${PORTAL_URL}/invoices`} className="hover:text-slate-800">
              Billing & Invoices
            </a>
            <a href={`${PORTAL_URL}/affiliate`} className="hover:text-slate-800">
              Affiliate Program
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
