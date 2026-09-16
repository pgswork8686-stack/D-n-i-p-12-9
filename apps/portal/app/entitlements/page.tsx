"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { TableSkeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card } from "@nexus/ui";
import { EntitlementDto } from "@nexus/contracts";

export default function EntitlementsPage() {
  const { token } = useAuth();
  const [entitlements, setEntitlements] = useState<EntitlementDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntitlements = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const res = await client.listEntitlements({ limit: 50 });
      setEntitlements(res.items || []);
    } catch (err: any) {
      setError(err.message || "Failed to load entitlements");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements]);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                My Products & Entitlements
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Active product access, support windows, and license fulfillment.
              </p>
            </div>
          </div>

          {error && <ErrorState message={error} onRetry={fetchEntitlements} />}

          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : entitlements.length === 0 ? (
            <EmptyState
              title="No Entitlements Found"
              description="You do not own any active product rights yet. Browse our marketplace to purchase themes and plugins."
              actionText="Browse Store"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <Card title="Purchased Products" subtitle={`Total ${entitlements.length} entitlement(s)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                      <th className="py-3 px-4">Product</th>
                      <th className="py-3 px-4">Fulfillment</th>
                      <th className="py-3 px-4">Updates Window</th>
                      <th className="py-3 px-4">Support Window</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entitlements.map((ent) => (
                      <tr key={ent.id} className="hover:bg-slate-50/50 transition">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">
                            Product #{ent.productId.slice(0, 8)}
                          </div>
                          <div className="text-xs text-slate-400 font-mono">
                            ID: {ent.id.slice(0, 8)} • Qty: {ent.quantity}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-block px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">
                            {ent.fulfillmentType}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          {ent.updatesUntil ? (
                            <span>Until {new Date(ent.updatesUntil).toLocaleDateString()}</span>
                          ) : (
                            <span className="text-emerald-600 font-semibold">Lifetime Updates</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          {ent.supportUntil ? (
                            <span>Until {new Date(ent.supportUntil).toLocaleDateString()}</span>
                          ) : (
                            <span className="text-slate-400">Standard</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={ent.status} />
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-2">
                          <Link href={`/entitlements/${ent.id}`}>
                            <Button variant="outline" size="sm">
                              Manage →
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
