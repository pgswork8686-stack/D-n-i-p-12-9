"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, Button } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function PublicProductsCatalogPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [currency, setCurrency] = useState<"USD" | "VND">("USD");
  const [sort, setSort] = useState<"newest" | "price_asc" | "price_desc" | "name_asc">("newest");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchCatalog = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (search) params.set("search", search);
    params.set("currency", currency);
    if (sort) params.set("sort", sort);

    const queryStr = params.toString();
    fetch(`${API_URL}/products${queryStr ? `?${queryStr}` : ""}`)
      .then((res) => res.json())
      .then((data) => {
        setProducts(data.items || []);
      })
      .catch((err) => {
        console.error("Failed to load products:", err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((res) => res.json())
      .then((data) => setCategories(data || []))
      .catch((err) => console.error("Failed to load categories:", err));
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [selectedCategory, currency, sort]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCatalog();
  };

  return (
    <main className="max-w-6xl mx-auto py-12 px-6 font-sans">
      <div className="pb-8 border-b border-gray-200 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-extrabold text-[#0037b0]">Digital Products</h1>
            <p className="text-gray-500 text-base mt-2">
              Themes, software plugins, Figma design assets, and external managed licenses.
            </p>
          </div>
          {/* Currency Switcher */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs">
            <span className="font-semibold px-2 text-gray-500">Currency:</span>
            <button
              onClick={() => setCurrency("USD")}
              className={`px-2.5 py-1 rounded font-bold transition ${
                currency === "USD"
                  ? "bg-[#0037b0] text-white shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              USD ($)
            </button>
            <button
              onClick={() => setCurrency("VND")}
              className={`px-2.5 py-1 rounded font-bold transition ${
                currency === "VND"
                  ? "bg-[#0037b0] text-white shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              VND (₫)
            </button>
          </div>
        </div>

        {/* Filters & Search & Sort */}
        <div className="flex flex-col sm:flex-row gap-4 mt-6 items-center justify-between">
          {/* Category Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 w-full sm:w-auto">
            <button
              onClick={() => setSelectedCategory("")}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                selectedCategory === ""
                  ? "bg-[#0037b0] text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              All Categories
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                  selectedCategory === c.slug
                    ? "bg-[#0037b0] text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Sort Selector */}
            <select
              value={sort}
              onChange={(e: any) => setSort(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="newest">Newest First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="name_asc">Name: A to Z</option>
            </select>

            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full sm:w-60">
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button variant="primary" type="submit" className="text-xs px-3">
                Search
              </Button>
            </form>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading catalog...</div>
      ) : products.length === 0 ? (
        <div className="p-12 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          No published products available in this category.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p) => (
            <Card key={p.id} className="flex flex-col justify-between p-6 border border-gray-200 hover:shadow-lg transition">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
                    {p.brand || "Nexus"}
                  </span>
                  <Badge variant="info">{p.productType}</Badge>
                </div>

                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  <Link href={`/products/${p.slug}`} className="hover:text-blue-600 transition">
                    {p.name}
                  </Link>
                </h3>

                <p className="text-gray-600 text-sm line-clamp-2 mb-4">
                  {p.shortDescription || "High quality digital product ready for activation."}
                </p>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <span className="text-xs text-gray-400 block">Starting from</span>
                  <span className="text-lg font-extrabold text-[#0037b0]">
                    {p.minPrice
                      ? formatMoney(p.minPrice.amount, p.minPrice.currency)
                      : "Free"}
                  </span>
                </div>
                <Link href={`/products/${p.slug}`}>
                  <Button variant="outline" className="text-xs py-1 px-3">
                    View Details →
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
