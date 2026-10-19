"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { EntitlementDto, OrderDto } from "@nexus/contracts";
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

type Filter = "" | "ACTIVE" | "EXPIRED" | "REVOKED";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "", label: "Tất cả" },
  { value: "ACTIVE", label: "Đang hoạt động" },
  { value: "EXPIRED", label: "Hết hạn" },
  { value: "REVOKED", label: "Đã thu hồi" },
];

export default function EntitlementsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<EntitlementDto[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const [ents, ords] = await Promise.all([client.listEntitlements({ limit: 50 }), client.listOrders({ limit: 50 })]);
      setItems(ents.items || []);
      setOrders(ords.items || []);
    } catch (err: any) {
      setError(err.message || "Không tải được danh sách sản phẩm.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const labels = buildProductLabels(orders);
  const visible = items.filter(e => !filter || e.status === filter);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <header>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Sản phẩm của tôi</h1>
            <p className="mt-1 text-sm text-slate-500">Quyền sử dụng, thời hạn cập nhật và hỗ trợ của các sản phẩm bạn đã mua.</p>
          </header>

          {error && <ErrorState message={error} onRetry={load} />}

          {!error && !loading && items.length > 0 && (
            <div role="group" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
              {FILTERS.map(f => (
                <button key={f.value || "all"} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${filter === f.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <TableSkeleton rows={4} cols={4} />
          ) : !error && items.length === 0 ? (
            <EmptyState
              title="Bạn chưa có sản phẩm nào"
              description="Khi mua theme, plugin hoặc UI kit, quyền sử dụng sẽ xuất hiện tại đây."
              actionText="Khám phá cửa hàng"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : !error && visible.length === 0 ? (
            <div className="rounded-2xl border bg-white p-10 text-center">
              <p className="font-semibold">Không có sản phẩm ở trạng thái này</p>
            </div>
          ) : !error && (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map(ent => {
                const label = productLabel(labels, ent.productId, ent.variantId);
                return (
                  <li key={ent.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-extrabold text-slate-900">{label.name}</h2>
                        {label.plan && <p className="text-sm text-slate-500">Gói {label.plan}</p>}
                      </div>
                      <StatusBadge status={ent.status} kind="entitlement" />
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="text-slate-400">Cập nhật đến</dt><dd className="font-semibold text-slate-800">{formatViDateOrNull(ent.updatesUntil, "Trọn đời")}</dd></div>
                      <div><dt className="text-slate-400">Hỗ trợ đến</dt><dd className="font-semibold text-slate-800">{formatViDateOrNull(ent.supportUntil, "Cơ bản")}</dd></div>
                    </dl>
                    <Link href={`/entitlements/${ent.id}`} className="mt-auto">
                      <Button variant="outline" size="sm">Xem chi tiết</Button>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
