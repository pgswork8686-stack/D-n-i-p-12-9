"use client";

import { billingTypeLabel, catalogStatusLabel, fulfillmentLabel, productTypeLabel } from "../../../lib/catalog-labels";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import { getApiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/auth-context";
import { effectiveAdminToken } from "../../../lib/admin-access-token";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function ProductDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { token, isLoading: authLoading } = useAuth();
  // Simulated identity requires explicit developer interaction. Production
  // always uses the centralized, Supabase-backed AuthProvider session.
  const [devToken, setDevToken] = useState<string | null>(null);
  const authToken = effectiveAdminToken(token, devToken, isDevAuthToolsEnabled);

  // Variant modal / subform state
  const [newSku, setNewSku] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
  const [addingVariant, setAddingVariant] = useState(false);

  // Price modal / subform state
  const [targetVariantId, setTargetVariantId] = useState<string | null>(null);
  const [priceAmount, setPriceAmount] = useState<number>(299000);
  const [priceCurrency, setPriceCurrency] = useState("VND");
  const [addingPrice, setAddingPrice] = useState(false);

  const fetchProduct = () => {
    if (!authToken) {
      setError("Không có quyền truy cập (401). Vui lòng đăng nhập bằng tài khoản quản trị.");
      setLoading(false);
      return;
    }

    let apiUrl = "";
    try {
      apiUrl = getApiUrl();
    } catch {
      setError("Admin API configuration unavailable");
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`${apiUrl}/admin/products/${id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Không tải được sản phẩm`);
        }
        return res.json();
      })
      .then((data) => {
        setProduct(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (id && !authLoading) fetchProduct();
  }, [id, authToken, authLoading]);

  const handleStatusChange = async (newStatus: string) => {
    setError(null);
    setSuccess(null);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/admin/products/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Không cập nhật được trạng thái`);
      }
      setSuccess(`Đã đổi trạng thái sản phẩm thành “${catalogStatusLabel(newStatus)}”`);
      fetchProduct();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingVariant(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/admin/products/${id}/variants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ sku: newSku, name: newVariantName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Không tạo được gói bán");
      }
      setNewSku("");
      setNewVariantName("");
      setSuccess("Đã tạo gói bán");
      fetchProduct();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingVariant(false);
    }
  };

  const handleCreatePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetVariantId) return;
    setAddingPrice(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/admin/variants/${targetVariantId}/prices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          currency: priceCurrency,
          amount: Number(priceAmount),
          billingType: "ONE_TIME",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Không thêm được giá");
      }
      setTargetVariantId(null);
      setSuccess("Đã thêm giá");
      fetchProduct();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingPrice(false);
    }
  };

  return (
    <main className="max-w-5xl mx-auto py-10 px-6 font-sans">
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

      {loading ? (
        <p className="text-gray-500 py-12">Đang tải sản phẩm…</p>
      ) : !product ? (
        <div>
          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 text-sm">
              <strong>Lỗi:</strong> {error}
            </div>
          )}
          <p className="text-red-500">Không tìm thấy sản phẩm hoặc bạn không có quyền xem.</p>
          <Link href="/admin/products" className="text-blue-600 underline mt-4 block">
            ← Danh sách sản phẩm
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between pb-6 border-b border-gray-200 mb-8">
        <div>
          <Link href="/admin/products" className="text-sm text-gray-500 hover:text-gray-700">
            ← Sản phẩm
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-3xl font-extrabold text-[#0037b0]">{product.name}</h1>
            <Badge
              variant={
                product.status === "ACTIVE"
                  ? "success"
                  : product.status === "DRAFT"
                    ? "warning"
                    : "error"
              }
            >
              {catalogStatusLabel(product.status)}
            </Badge>
          </div>
          <p className="text-gray-500 text-sm font-mono mt-1">slug: {product.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/products/${encodeURIComponent(product.id)}/versions`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Phiên bản &amp; file
          </Link>
          {product.status !== "ACTIVE" && (
            <Button variant="primary" onClick={() => handleStatusChange("ACTIVE")}>
              Đăng bán
            </Button>
          )}
          {product.status !== "DRAFT" && (
            <Button variant="outline" onClick={() => handleStatusChange("DRAFT")}>
              Chuyển về bản nháp
            </Button>
          )}
          {product.status !== "ARCHIVED" && (
            <Button variant="outline" onClick={() => handleStatusChange("ARCHIVED")}>
              Lưu trữ
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 text-sm">
          <strong>Lỗi:</strong> {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg mb-6 border border-green-200 text-sm">
          {success}
        </div>
      )}

      {/* Product Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="p-4 border border-gray-200">
          <p className="text-xs text-gray-400 font-semibold uppercase">Loại sản phẩm</p>
          <p className="text-base font-bold text-gray-800 mt-1">{productTypeLabel(product.productType)}</p>
        </Card>
        <Card className="p-4 border border-gray-200">
          <p className="text-xs text-gray-400 font-semibold uppercase">Hình thức bàn giao</p>
          <p className="text-base font-bold text-gray-800 mt-1">{fulfillmentLabel(product.fulfillmentType)}</p>
        </Card>
        <Card className="p-4 border border-gray-200">
          <p className="text-xs text-gray-400 font-semibold uppercase">Thương hiệu / nhà cung cấp</p>
          <p className="text-base font-bold text-gray-800 mt-1">{product.brand || "—"}</p>
        </Card>
      </div>

      {/* Variants & Pricing Section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Gói bán & giá</h2>
        </div>

        <div className="space-y-4">
          {product.variants?.map((v: any) => (
            <Card key={v.id} className="p-5 border border-gray-200">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div>
                  <h3 className="font-bold text-gray-900">{v.name}</h3>
                  <p className="text-xs font-mono text-gray-500">SKU: {v.sku}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={v.status === "ACTIVE" ? "success" : "warning"}>
                    {catalogStatusLabel(v.status)}
                  </Badge>
                  <Button
                    variant="outline"
                    className="text-xs py-1 px-2"
                    onClick={() => setTargetVariantId(v.id)}
                  >
                    + Thêm giá
                  </Button>
                </div>
              </div>

              {/* Prices list */}
              <div className="pt-3">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase">
                  Giá đã cấu hình:
                </p>
                {v.prices?.length === 0 ? (
                  <p className="text-xs text-gray-400">Gói này chưa có giá.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {v.prices?.map((pr: any) => (
                      <div
                        key={pr.id}
                        className="border border-gray-200 rounded px-3 py-1.5 bg-gray-50 text-xs"
                      >
                        <span className="font-bold text-gray-800">
                          {pr.amount.toLocaleString("vi-VN")} {pr.currency}
                        </span>
                        <span className="text-gray-400 ml-1.5 font-medium">
                          ({billingTypeLabel(pr.billingType)})
                        </span>
                        {pr.isActive ? (
                          <span className="text-green-600 ml-2 font-bold">✓ Đang áp dụng</span>
                        ) : (
                          <span className="text-red-500 ml-2">Ngừng áp dụng</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Add Price Inline Modal */}
              {targetVariantId === v.id && (
                <form
                  onSubmit={handleCreatePrice}
                  className="mt-4 p-4 bg-blue-50/60 rounded-lg border border-blue-200 flex items-center gap-3"
                >
                  <div className="text-xs font-semibold text-blue-900">
                    Thêm giá cho {v.name}:
                  </div>
                  <input
                    type="number"
                    min="0"
                    required
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(Number(e.target.value))}
                    placeholder="Số tiền"
                    className="w-32 px-2 py-1 text-sm border border-gray-300 rounded"
                  />
                  <select
                    value={priceCurrency}
                    onChange={(e) => setPriceCurrency(e.target.value)}
                    className="px-2 py-1 text-sm border border-gray-300 rounded bg-white"
                  >
                    <option value="VND">VND</option>
                    <option value="USD">USD</option>
                  </select>
                  <Button variant="primary" type="submit" disabled={addingPrice}>
                    {addingPrice ? "Đang lưu…" : "Lưu"}
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setTargetVariantId(null)}
                  >
                    Cancel
                  </Button>
                </form>
              )}
            </Card>
          ))}
        </div>

        {/* Create Variant Card */}
        <Card className="mt-6 p-5 border border-dashed border-gray-300 bg-gray-50/50">
          <h3 className="font-bold text-gray-800 text-sm mb-3">+ Thêm gói bán</h3>
          <form onSubmit={handleCreateVariant} className="flex gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="pd-1" className="block text-xs text-gray-600 mb-1">Tên gói *</label>
              <input id="pd-1"
                type="text"
                required
                value={newVariantName}
                onChange={(e) => setNewVariantName(e.target.value)}
                placeholder="vd: 5 website hoặc Không giới hạn"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="pd-2" className="block text-xs text-gray-600 mb-1">SKU *</label>
              <input id="pd-2"
                type="text"
                required
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                placeholder="vd: PROD-5SITES"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono bg-white"
              />
            </div>
            <Button variant="primary" type="submit" disabled={addingVariant}>
              {addingVariant ? "Đang thêm…" : "Thêm gói"}
            </Button>
          </form>
        </Card>
      </div>
        </>
      )}
    </main>
  );
}
