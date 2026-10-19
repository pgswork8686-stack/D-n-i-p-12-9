"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { CustomerLicenseDto, OrderDto } from "@nexus/contracts";
import { Button } from "@nexus/ui";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { TableSkeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { buildProductLabels, formatViDateOrNull, productLabel } from "../lib/product-names";

export default function LicensesPage() {
  const { token } = useAuth();
  const [licenses, setLicenses] = useState<CustomerLicenseDto[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const [lics, ords] = await Promise.all([client.listLicenses(), client.listOrders({ limit: 50 })]);
      setLicenses(lics || []);
      setOrders(ords.items || []);
    } catch (err: any) {
      setError(err.message || "Không tải được danh sách license.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const labels = buildProductLabels(orders);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <header>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">License của tôi</h1>
            <p className="mt-1 text-sm text-slate-500">Khóa kích hoạt luôn được che; chỉ hiện đầy đủ khi bạn chủ động chọn “Hiện license key” trong trang chi tiết.</p>
          </header>

          {error && <ErrorState message={error} onRetry={load} />}

          {loading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : !error && licenses.length === 0 ? (
            <EmptyState
              title="Bạn chưa có license nào"
              description="Khi mua sản phẩm có license, khóa kích hoạt sẽ xuất hiện tại đây."
              actionText="Khám phá cửa hàng"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : !error && (
            <div className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-5 py-4">Sản phẩm</th>
                    <th scope="col" className="px-5 py-4">License key</th>
                    <th scope="col" className="px-5 py-4">Tên miền đã dùng</th>
                    <th scope="col" className="px-5 py-4">Cập nhật đến</th>
                    <th scope="col" className="px-5 py-4">Trạng thái</th>
                    <th scope="col" className="px-5 py-4"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {licenses.map(lic => {
                    const label = productLabel(labels, lic.productId, lic.variantId);
                    return (
                      <tr key={lic.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-4">
                          <div className="font-bold text-slate-900">{label.name}</div>
                          {label.plan && <div className="text-xs text-slate-500">Gói {label.plan}</div>}
                        </td>
                        <td className="px-5 py-4 font-mono text-xs font-bold text-slate-900">{lic.keyMasked}</td>
                        <td className="px-5 py-4 text-slate-700">
                          <span className="font-bold text-slate-900">{lic.activeActivations}</span>
                          {" / "}{lic.maxActivations !== null ? lic.maxActivations : "Không giới hạn"}
                        </td>
                        <td className="px-5 py-4 text-slate-600">{formatViDateOrNull(lic.updatesUntil, "Trọn đời")}</td>
                        <td className="px-5 py-4"><StatusBadge status={lic.status} kind="license" /></td>
                        <td className="px-5 py-4 text-right">
                          <Link href={`/licenses/${lic.id}`}><Button variant="outline" size="sm">Xem chi tiết</Button></Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
