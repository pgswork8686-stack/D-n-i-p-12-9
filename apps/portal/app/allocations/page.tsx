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

interface EntitlementAllocations {
  entitlement: EntitlementDto;
  allocations: CustomerAllocationDto[];
}

export default function AllocationsPage() {
  const { token } = useAuth();
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
      const externalEntitlements = (entitlementsRes.items || []).filter(
        (e) => e.fulfillmentType === "EXTERNAL_MANAGED" && e.status === "ACTIVE",
      );

      const loaded: EntitlementAllocations[] = [];
      for (const ent of externalEntitlements) {
        try {
          const allocs = await client.listAllocations(ent.id);
          loaded.push({ entitlement: ent, allocations: allocs || [] });
        } catch {
          loaded.push({ entitlement: ent, allocations: [] });
        }
      }

      setData(loaded);
      if (loaded.length > 0 && !selectedEntitlementId) {
        setSelectedEntitlementId(loaded[0].entitlement.id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load external license allocations");
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
      setActionSuccess(`Allocation requested successfully for domain: ${domainInput.trim()}`);
      setDomainInput("");
      await fetchAllocations();
    } catch (err: any) {
      setActionError(err.message || "Failed to request domain allocation");
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
        "Customer requested deactivation via portal",
      );
      setActionSuccess("Deactivation requested successfully.");
      await fetchAllocations();
    } catch (err: any) {
      setActionError(err.message || "Failed to request deactivation");
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-5xl">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              External Managed Allocations
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Connect external vendor licenses (e.g. Elementor Pro) to your domains securely.
            </p>
          </div>

          {/* Privacy & Boundary Guarantee Notice */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-100 text-xs text-emerald-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <span>🔒</span>
              <span>Managed License Privacy Guarantee</span>
            </div>
            <p className="text-emerald-700 leading-relaxed">
              External license slots are securely allocated by backend operators. Upstream vendor credentials,
              subscription tokens, and master account access are strictly protected and never exposed to the client.
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
              title="No External Managed Entitlements"
              description="You do not have any active products requiring external managed allocations (such as Elementor Pro)."
              actionText="Shop Marketplace"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <>
              {/* Request New Domain Allocation Form */}
              <Card
                title="Request Domain Activation"
                subtitle="Submit your WordPress domain for managed license allocation"
              >
                <form onSubmit={handleRequestAllocation} className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="entitlementSelect"
                        className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
                      >
                        Target Entitlement
                      </label>
                      <select
                        id="entitlementSelect"
                        value={selectedEntitlementId}
                        onChange={(e) => setSelectedEntitlementId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0] focus:bg-white transition"
                      >
                        {data.map(({ entitlement }) => (
                          <option key={entitlement.id} value={entitlement.id}>
                            Product #{entitlement.productId.slice(0, 8)} (
                            {entitlement.maxActivations !== null
                              ? `${entitlement.maxActivations} slots`
                              : "Slots Available"}
                            )
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="domainInput"
                        className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
                      >
                        Website Domain
                      </label>
                      <input
                        id="domainInput"
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="e.g. mysite.com"
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
                      {submitting ? "Submitting Request..." : "Request Allocation →"}
                    </Button>
                  </div>
                </form>
              </Card>

              {/* Existing Allocations List */}
              {data.map(({ entitlement, allocations }) => (
                <Card
                  key={entitlement.id}
                  title={`Allocations: Product #${entitlement.productId.slice(0, 8)}`}
                  subtitle={`Entitlement ID: ${entitlement.id.slice(0, 8)} • Max Slots: ${
                    entitlement.maxActivations ?? "Unlimited"
                  }`}
                  headerAction={<StatusBadge status={entitlement.status} />}
                >
                  {allocations.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3">
                      No domains have been allocated yet for this entitlement.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                            <th className="py-3 px-4">Domain</th>
                            <th className="py-3 px-4">Requested At</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allocations.map((alloc) => (
                            <tr key={alloc.id}>
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                                🌐 {alloc.domain}
                              </td>
                              <td className="py-3.5 px-4 text-xs text-slate-500">
                                {new Date(alloc.createdAt).toLocaleDateString()}
                              </td>
                              <td className="py-3.5 px-4">
                                <StatusBadge status={alloc.status} />
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
                                    Request Deactivation
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
