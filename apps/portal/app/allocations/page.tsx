"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card } from "@nexus/ui";
import {
  EntitlementDto,
  CustomerAllocationDto,
} from "@nexus/contracts";
import {
  EntitlementAllocations,
  loadAllocationsForEntitlements,
} from "../lib/portal-actions";
import { buildProductLabels, formatViDateOrNull, productLabel } from "../lib/product-names";

export default function AllocationsPage() {
  const { token } = useAuth();
  const [labels, setLabels] = useState(() => buildProductLabels([]));
  const [data, setData] = useState<EntitlementAllocations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New allocation request form
  const [selectedEntitlementId, setSelectedEntitlementId] = useState<string>("");
  const [domainInput, setDomainInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchAllocations = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const entitlementsRes = await client.listEntitlements({ limit: 50 });
      try { setLabels(buildProductLabels((await client.listOrders({ limit: 50 })).items || [])); } catch { /* names are optional */ }
      const loaded = await loadAllocationsForEntitlements(
        client,
        entitlementsRes.items || [],
      );

      setData(loaded);
      if (loaded.length > 0 && !selectedEntitlementId) {
        setSelectedEntitlementId(loaded[0].entitlement.id);
      }
    } catch (err: any) {
      setError(err.message || "Không tải được danh sách tên miền.");
    } finally {
      setLoading(false);
    }
  }, [token, selectedEntitlementId]);

  useEffect(() => {
    fetchAllocations();
  }, [fetchAllocations]);

  const handleRequestAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedEntitlementId || !domainInput.trim()) return;

    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const client = getApiClient(token);
      await client.requestAllocation(selectedEntitlementId, domainInput.trim());
      setActionSuccess(`Đã gửi yêu cầu kích hoạt cho tên miền: ${domainInput.trim()}`);
      setDomainInput("");
      await fetchAllocations();
    } catch (err: any) {
      setActionError(err.message || "Không gửi được yêu cầu kích hoạt tên miền.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDeactivation = async (
    entitlementId: string,
    allocationId: string,
  ) => {
    if (!token) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      const client = getApiClient(token);
      await client.requestDeactivation(
        entitlementId,
        allocationId,
        "Khách hàng yêu cầu hủy kích hoạt qua cổng khách hàng",
      );
      setActionSuccess("Đã gửi yêu cầu hủy kích hoạt.");
      await fetchAllocations();
    } catch (err: any) {
      setActionError(err.message || "Không gửi được yêu cầu hủy kích hoạt.");
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-5xl">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Kích hoạt tên miền
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Gửi tên miền website để chúng tôi cấp quyền cho license do nhà cung cấp bên ngoài quản lý (ví dụ Elementor Pro).
            </p>
          </div>

          {/* Privacy & Boundary Guarantee Notice */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-100 text-xs text-emerald-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <span aria-hidden="true">🔒</span>
              <span>Thông tin license được bảo vệ</span>
            </div>
            <p className="text-emerald-700 leading-relaxed">
              Suất kích hoạt do đội vận hành cấp. Thông tin tài khoản và khóa của nhà cung cấp bên ngoài không bao giờ hiển thị cho khách hàng.
            </p>
          </div>

          {error && <ErrorState message={error} onRetry={fetchAllocations} />}

          {actionSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold">
              ✓ {actionSuccess}
            </div>
          )}

          {actionError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-semibold">
              ⚠️ {actionError}
            </div>
          )}

          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-44 w-full rounded-2xl" />
              <Skeleton className="h-56 w-full rounded-2xl" />
            </div>
          ) : data.length === 0 ? (
            <EmptyState
              title="Chưa có sản phẩm cần kích hoạt tên miền"
              description="Bạn chưa có sản phẩm nào cần cấp suất kích hoạt bên ngoài (như Elementor Pro)."
              actionText="Khám phá cửa hàng"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <>
              {/* Request New Domain Allocation Form */}
              <Card
                title="Thêm tên miền"
                subtitle="Gửi tên miền WordPress của bạn để được cấp suất kích hoạt"
              >
                <form onSubmit={handleRequestAllocation} className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="entitlementSelect"
                        className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
                      >
                        Sản phẩm
                      </label>
                      <select
                        id="entitlementSelect"
                        value={selectedEntitlementId}
                        onChange={(e) => setSelectedEntitlementId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0] focus:bg-white transition"
                      >
                        {data.map(({ entitlement }) => (
                          <option key={entitlement.id} value={entitlement.id}>
                            {productLabel(labels, entitlement.productId, entitlement.variantId).name} ({entitlement.maxActivations !== null ? `${entitlement.maxActivations} tên miền` : "Còn suất"})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="domainInput"
                        className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
                      >
                        Tên miền website
                      </label>
                      <input
                        id="domainInput"
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="vd: tenmiencuaban.com"
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0] focus:bg-white transition"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={submitting || !domainInput.trim()}
                    >
                      {submitting ? "Đang gửi…" : "Gửi yêu cầu →"}
                    </Button>
                  </div>
                </form>
              </Card>

              {/* Existing Allocations List */}
              {data.map(({ entitlement, allocations }) => (
                <Card
                  key={entitlement.id}
                  title={`Tên miền: ${productLabel(labels, entitlement.productId, entitlement.variantId).name}`}
                  subtitle={`Số tên miền tối đa: ${entitlement.maxActivations ?? "Không giới hạn"}`}
                  headerAction={<StatusBadge status={entitlement.status} kind="entitlement" />}
                >
                  {allocations.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3">
                      Chưa có tên miền nào được gửi cho sản phẩm này.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                            <th className="py-3 px-4">Tên miền</th>
                            <th className="py-3 px-4">Tên miền đã gửi lúc</th>
                            <th className="py-3 px-4">Trạng thái</th>
                            <th className="py-3 px-4 text-right"><span className="sr-only">Thao tác</span></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allocations.map((alloc) => (
                            <tr key={alloc.id}>
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                                🌐 {alloc.domain}
                              </td>
                              <td className="py-3.5 px-4 text-xs text-slate-500">
                                {formatViDateOrNull(alloc.createdAt)}
                              </td>
                              <td className="py-3.5 px-4">
                                <StatusBadge status={alloc.status} kind="allocation" />
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                {alloc.status === "ACTIVE" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleRequestDeactivation(
                                        entitlement.id,
                                        alloc.id,
                                      )
                                    }
                                    className="text-red-600 hover:bg-red-50 text-xs"
                                  >
                                    Yêu cầu hủy kích hoạt
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
