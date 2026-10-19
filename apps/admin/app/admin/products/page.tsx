"use client";

import { catalogStatusLabel, fulfillmentLabel, productTypeLabel } from "../../lib/catalog-labels";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import { getApiUrl } from "../../lib/api";
import { useAuth } from "../../context/auth-context";
import { effectiveAdminToken } from "../../lib/admin-access-token";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token, isLoading: authLoading } = useAuth();
  // Simulated identity requires explicit developer interaction. Production
  // always uses the centralized, Supabase-backed AuthProvider session.
  const [devToken, setDevToken] = useState<string | null>(null);
  const authToken = effectiveAdminToken(token, devToken, isDevAuthToolsEnabled);

  const fetchProducts = () => {
    if (!authToken) {
      setError("Không có quyền truy cập (401). Vui lòng đăng nhập bằng tài khoản quản trị.");
      setLoading(false);
      setProducts([]);
      return;
    }

    let apiUrl = "";
    try {
      apiUrl = getApiUrl();
    } catch {
      setError("Chưa cấu hình địa chỉ API quản trị.");
      setLoading(false);
      setProducts([]);
      return;
    }

    setLoading(true);
    fetch(`${apiUrl}/admin/products`, {
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
    if (!authLoading) fetchProducts();
  }, [authToken, authLoading]);

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      {isDevAuthToolsEnabled && (
        <div className="mb-6 bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Giả lập token (chỉ môi trường thử nghiệm):</span>
          <div className="flex gap-2">
            <button
              onClick={() => setDevToken("dev-admin-token")}
              className={`px-2.5 py-1 rounded border font-medium ${authToken === "dev-admin-token" ? "bg-[#0037b0] text-white" : "bg-white text-gray-700"}`}
            >
              Token quản trị
            </button>
            <button
              onClick={() => setDevToken("dev-customer-token")}
              className={`px-2.5 py-1 rounded border font-medium ${authToken === "dev-customer-token" ? "bg-amber-600 text-white" : "bg-white text-gray-700"}`}
            >
              Token khách hàng (403)
            </button>
            <button
              onClick={() => setDevToken("")}
              className={`px-2.5 py-1 rounded border font-medium ${!authToken ? "bg-red-600 text-white" : "bg-white text-gray-700"}`}
            >
              Không token (401)
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pb-6 border-b border-gray-200 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
              ← Tổng quan
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold text-[#0037b0] mt-2">
            Quản lý sản phẩm
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Quản lý sản phẩm số, gói bán và giá
          </p>
        </div>
        <Link href="/admin/categories" className="mr-4 font-semibold text-blue-700 hover:underline">Danh mục</Link>
        <Link href="/admin/products/new">
          <Button variant="primary">+ Thêm sản phẩm</Button>
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 text-sm">
          <strong>Lỗi:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-500">Đang tải danh sách sản phẩm…</div>
      ) : (
        <Card className="overflow-hidden p-0 border border-gray-200">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <th className="py-3 px-4">Tên sản phẩm</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">Loại</th>
                  <th className="py-3 px-4">Bàn giao</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4">Gói bán</th>
                  <th className="py-3 px-4 text-right"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      Chưa có sản phẩm. Chọn “+ Thêm sản phẩm” để tạo mới.
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
                          {productTypeLabel(p.productType)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 font-medium border border-purple-200">
                          {fulfillmentLabel(p.fulfillmentType)}
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
                          {catalogStatusLabel(p.status)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {p.variants?.length || 0} gói
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="text-blue-600 hover:text-blue-800 font-medium text-xs underline"
                        >
                          Sửa & gói bán
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
