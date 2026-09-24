"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  PriceDisplay,
  ProductVersionBadge,
  FacetedFilter,
  CartDrawer,
  CartDrawerItem,
} from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const PRODUCT_TYPES = [
  { id: "DOWNLOADABLE_ASSET", label: "Downloads" },
  { id: "LICENSED_SOFTWARE", label: "Plugins & Software" },
  { id: "MEMBERSHIP", label: "Membership Passes" },
  { id: "HOSTING_PROVISIONING", label: "Cloud Hosting" },
];

export default function PublicProductsCatalogPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedProductTypes, setSelectedProductTypes] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState<number | undefined>();
  const [maxPrice, setMaxPrice] = useState<number | undefined>();
  const [currency, setCurrency] = useState<"USD" | "VND">("USD");
  const [sort, setSort] = useState<string>("newest");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Cart Drawer State
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartDrawerItem[]>([]);

  const fetchCatalog = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedCategoryIds.length > 0) {
      params.set("category", selectedCategoryIds[0]); // API single-category filter
    }
    if (selectedProductTypes.length > 0) {
      params.set("productType", selectedProductTypes[0]);
    }
    if (search) params.set("search", search);
    params.set("currency", currency);
    if (sort) params.set("sort", sort);

    const queryStr = params.toString();
    fetch(`${API_URL}/products${queryStr ? `?${queryStr}` : ""}`)
      .then((res) => res.json())
      .then((data) => {
        let items = data.items || [];
        // Client-side multi-facet refinement if multiple categories selected
        if (selectedCategoryIds.length > 1) {
          items = items.filter((p: any) =>
            p.categories?.some((c: any) => selectedCategoryIds.includes(c.id)),
          );
        }
        // Client-side price filtering if specified
        if (minPrice != null) {
          items = items.filter((p: any) => {
            const price = p.variants?.[0]?.prices?.[0]?.amount ?? 0;
            return price >= minPrice * 100;
          });
        }
        if (maxPrice != null) {
          items = items.filter((p: any) => {
            const price = p.variants?.[0]?.prices?.[0]?.amount ?? 0;
            return price <= maxPrice * 100;
          });
        }
        setProducts(items);
      })
      .catch((err) => {
        console.error("Failed to load products:", err);
      })
      .finally(() => setLoading(false));
  }, [selectedCategoryIds, selectedProductTypes, search, currency, sort, minPrice, maxPrice]);

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((res) => res.json())
      .then((data) => setCategories(data || []))
      .catch((err) => console.error("Failed to load categories:", err));
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const handleCategoryToggle = (id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const handleProductTypeToggle = (pt: string) => {
    setSelectedProductTypes((prev) =>
      prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt],
    );
  };

  const handleResetFilters = () => {
    setSelectedCategoryIds([]);
    setSelectedProductTypes([]);
    setMinPrice(undefined);
    setMaxPrice(undefined);
    setSearch("");
    setSort("newest");
  };

  const handleAddToCart = (product: any) => {
    const defaultVariant = product.variants?.[0];
    const defaultPrice = defaultVariant?.prices?.[0];
    const unitAmountMinor = defaultPrice?.amount ?? 4900;

    const newItem: CartDrawerItem = {
      id: defaultVariant?.id || product.id,
      name: product.name,
      variantName: defaultVariant?.name,
      unitAmountMinor,
      quantity: 1,
    };

    setCartItems((prev) => {
      const existing = prev.find((it) => it.id === newItem.id);
      if (existing) {
        return prev.map((it) =>
          it.id === newItem.id ? { ...it, quantity: it.quantity + 1 } : it,
        );
      }
      return [...prev, newItem];
    });

    setIsCartOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#0037b0] text-white flex items-center justify-center font-black text-lg">
              N
            </span>
            <span className="font-extrabold text-[#0037b0] text-lg tracking-tight">
              NEXUSTHEME
            </span>
          </Link>

          {/* Quick Search in Header */}
          <div className="hidden sm:flex flex-1 max-w-md items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 focus-within:border-[#0037b0] focus-within:bg-white transition-all">
            <span className="text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Search catalog..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none text-slate-900 placeholder-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Currency Switcher */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCurrency("USD")}
                className={`px-2 py-1 rounded ${currency === "USD" ? "bg-[#0037b0] text-white" : "text-slate-600"}`}
              >
                USD ($)
              </button>
              <button
                type="button"
                onClick={() => setCurrency("VND")}
                className={`px-2 py-1 rounded ${currency === "VND" ? "bg-[#0037b0] text-white" : "text-slate-600"}`}
              >
                VND (₫)
              </button>
            </div>

            {/* Cart Trigger */}
            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              <span className="text-xl">🛒</span>
              {cartItems.length > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#0037b0] text-white text-[10px] font-bold flex items-center justify-center">
                  {cartItems.reduce((s, it) => s + it.quantity, 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Catalog Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Title & Sort Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-950 tracking-tight">
              Digital Products Marketplace
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Showing {products.length} digital themes, verified plugins, and hosting tiers.
            </p>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Sort by:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="newest">Newest First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="name_asc">Name: A to Z</option>
            </select>
          </div>
        </div>

        {/* Content Body: Sidebar Filter + Product Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
          {/* Faceted Filter Sidebar */}
          <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm sticky top-24">
            <FacetedFilter
              categories={categories}
              selectedCategoryIds={selectedCategoryIds}
              onCategoryToggle={handleCategoryToggle}
              productTypes={PRODUCT_TYPES}
              selectedProductTypes={selectedProductTypes}
              onProductTypeToggle={handleProductTypeToggle}
              minPrice={minPrice}
              maxPrice={maxPrice}
              onPriceChange={(min, max) => {
                setMinPrice(min);
                setMaxPrice(max);
              }}
              currency={currency}
              onReset={handleResetFilters}
            />
          </div>

          {/* Products Grid */}
          <div className="lg:col-span-3">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-80 rounded-2xl bg-white border border-slate-200 animate-pulse p-6" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
                <span className="text-5xl block">🔍</span>
                <h3 className="text-lg font-bold text-slate-900">No products match your criteria</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Try clearing some filter facets or search for different keywords.
                </p>
                <Button onClick={handleResetFilters} variant="outline" size="sm">
                  Reset Filters
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {products.map((p) => {
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
                            className="text-base font-bold text-slate-900 group-hover:text-[#0037b0] transition-colors block leading-snug"
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
                            currency={currency}
                            size="md"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAddToCart(p)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0037b0] hover:bg-[#002c8f] text-white shadow-sm transition-all"
                            >
                              Add to Cart 🛒
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Slide-over Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        currency={currency}
        onUpdateQuantity={(id, qty) => {
          setCartItems((prev) =>
            prev.map((it) => (it.id === id ? { ...it, quantity: qty } : it)),
          );
        }}
        onRemoveItem={(id) => {
          setCartItems((prev) => prev.filter((it) => it.id !== id));
        }}
        checkoutUrl={`/checkout?currency=${currency}`}
      />
    </div>
  );
}
