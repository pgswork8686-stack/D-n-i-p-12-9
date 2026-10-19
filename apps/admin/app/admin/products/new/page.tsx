"use client";

import { fulfillmentLabel, productTypeLabel } from "../../../lib/catalog-labels";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@nexus/ui";
import { getApiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/auth-context";
import { effectiveAdminToken } from "../../../lib/admin-access-token";

const PRODUCT_TYPES = [
  "DOWNLOADABLE_ASSET",
  "LICENSED_SOFTWARE",
  "EXTERNAL_MANAGED_LICENSE",
  "MEMBERSHIP",
  "SUBSCRIPTION",
  "SERVICE",
];

const FULFILLMENT_TYPES = [
  "DIGITAL_DOWNLOAD",
  "INTERNAL_LICENSE",
  "EXTERNAL_MANAGED",
  "MEMBERSHIP_ACCESS",
  "MANUAL_SERVICE",
];

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function NewProductPage() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  // Simulated identity requires explicit developer interaction. Production
  // always uses the centralized, Supabase-backed AuthProvider session.
  const [devToken, setDevToken] = useState<string | null>(null);
  const authToken = effectiveAdminToken(token, devToken, isDevAuthToolsEnabled);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    productType: "DOWNLOADABLE_ASSET",
    fulfillmentType: "DIGITAL_DOWNLOAD",
    status: "DRAFT",
    brand: "",
    shortDescription: "",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const generatedSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug === "" || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ? generatedSlug : prev.slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) {
      setError("Không có quyền truy cập (401). Vui lòng đăng nhập bằng tài khoản quản trị.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/admin/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Không tạo được sản phẩm (${res.status})`);
      }

      const created = await res.json();
      router.push(`/admin/products/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto py-10 px-6 font-sans">
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
      <div className="pb-6 border-b border-gray-200 mb-8">
        <Link href="/admin/products" className="text-sm text-gray-500 hover:text-gray-700">
          ← Sản phẩm
        </Link>
        <h1 className="text-3xl font-extrabold text-[#0037b0] mt-2">
          Thêm sản phẩm
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Nhập thông tin sản phẩm, hình thức bàn giao và trạng thái ban đầu
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 text-sm">
          <strong>Dữ liệu chưa hợp lệ:</strong> {error}
        </div>
      )}

      <Card className="p-6 border border-gray-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="np-1" className="block text-xs font-semibold text-gray-700 mb-1">
                Tên sản phẩm *
              </label>
              <input id="np-1"
                type="text"
                required
                value={formData.name}
                onChange={handleNameChange}
                placeholder="e.g. Nexus Pro Plugin"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="np-2" className="block text-xs font-semibold text-gray-700 mb-1">
                Đường dẫn (slug) *
              </label>
              <input id="np-2"
                type="text"
                required
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                title="Chỉ gồm chữ thường, số và dấu gạch ngang"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                placeholder="e.g. nexus-pro-plugin"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label htmlFor="np-3" className="block text-xs font-semibold text-gray-700 mb-1">
                Loại sản phẩm *
              </label>
              <select id="np-3"
                value={formData.productType}
                onChange={(e) => setFormData({ ...formData, productType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {productTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="np-4" className="block text-xs font-semibold text-gray-700 mb-1">
                Hình thức bàn giao *
              </label>
              <select id="np-4"
                value={formData.fulfillmentType}
                onChange={(e) => setFormData({ ...formData, fulfillmentType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FULFILLMENT_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {fulfillmentLabel(f)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="np-5" className="block text-xs font-semibold text-gray-700 mb-1">
                Trạng thái ban đầu *
              </label>
              <select id="np-5"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="DRAFT">Bản nháp (ẩn)</option>
                <option value="ACTIVE">Đang bán (công khai)</option>
                <option value="ARCHIVED">Đã lưu trữ</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="np-6" className="block text-xs font-semibold text-gray-700 mb-1">
              Thương hiệu / nhà cung cấp
            </label>
            <input id="np-6"
              type="text"
              value={formData.brand}
              onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              placeholder="e.g. NexusTheme or Elementor"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="np-7" className="block text-xs font-semibold text-gray-700 mb-1">
              Mô tả ngắn
            </label>
            <input id="np-7"
              type="text"
              value={formData.shortDescription}
              onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
              placeholder="Tóm tắt ngắn hiển thị ở danh sách…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="np-8" className="block text-xs font-semibold text-gray-700 mb-1">
              Mô tả đầy đủ
            </label>
            <textarea id="np-8"
              rows={4}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Thông tin chi tiết, tính năng, khả năng tương thích…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Link href="/admin/products">
              <Button variant="outline" type="button">
                Hủy
              </Button>
            </Link>
            <Button variant="primary" type="submit" disabled={submitting || authLoading}>
              {submitting ? "Đang lưu…" : "Tạo sản phẩm"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
