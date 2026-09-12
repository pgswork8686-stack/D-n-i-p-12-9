"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>(
    isDevAuthToolsEnabled ? "dev-admin-token" : "",
  );

  const fetchProducts = () => {
    if (!authToken) {
      setError("Access Denied (401 Unauthorized): Please provide an authenticated admin token or login via Supabase session.");
      setLoading(false);
      setProducts([]);
      return;
    }

    setLoading(true);
    fetch(`${API_URL}/admin/products`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setProducts(data.items || []);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProducts();
  }, [authToken]);

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      {isDevAuthToolsEnabled && (
        <div className="mb-6 bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Simulate Token (Dev Only):</span>
          <div className="flex gap-2">
            <button
              onClick={() => setAuthToken("dev-admin-token")}
              className={`px-2.5 py-1 rounded border font-medium ${authToken === "dev-admin-token" ? "bg-[#0037b0] text-white" : "bg-white text-gray-700"}`}
            >
              Admin Token
            </button>
            <button
              onClick={() => setAuthToken("dev-customer-token")}
              className={`px-2.5 py-1 rounded border font-medium ${authToken === "dev-customer-token" ? "bg-amber-600 text-white" : "bg-white text-gray-700"}`}
            >
              Customer Token (403)
            </button>
            <button
              onClick={() => setAuthToken("")}
              className={`px-2.5 py-1 rounded border font-medium ${!authToken ? "bg-red-600 text-white" : "bg-white text-gray-700"}`}
            >
              No Token (401)
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pb-6 border-b border-gray-200 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
              ← Dashboard
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold text-[#0037b0] mt-2">
            Catalog Management
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage digital products, variants, and pricing structures
          </p>
        </div>
        <Link href="/admin/products/new">
          <Button variant="primary">+ New Product</Button>
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-500">Loading catalog products...</div>
      ) : (
        <Card className="overflow-hidden p-0 border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <th className="py-3 px-4">Product Name</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Fulfillment</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Variants</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      No products found. Click &quot;+ New Product&quot; to create one.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/60 transition">
                      <td className="py-3 px-4 font-medium text-gray-900">
                        {p.name}
                        {p.brand && (
                          <span className="block text-xs text-gray-400">{p.brand}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-500 font-mono text-xs">
                        {p.slug}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-medium border border-blue-200">
                          {p.productType}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 font-medium border border-purple-200">
                          {p.fulfillmentType}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            p.status === "ACTIVE"
                              ? "success"
                              : p.status === "DRAFT"
                                ? "warning"
                                : "error"
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {p.variants?.length || 0} variant(s)
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="text-blue-600 hover:text-blue-800 font-medium text-xs underline"
                        >
                          Edit & Variants
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
