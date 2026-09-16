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
import { CustomerLicenseDto } from "@nexus/contracts";

export default function LicensesPage() {
  const { token } = useAuth();
  const [licenses, setLicenses] = useState<CustomerLicenseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLicenses = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const res = await client.listLicenses();
      setLicenses(res || []);
    } catch (err: any) {
      setError(err.message || "Failed to load licenses");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLicenses();
  }, [fetchLicenses]);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Internal Licenses
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Manage your product activation keys, seats, and connected domains.
              </p>
            </div>
          </div>

          {error && <ErrorState message={error} onRetry={fetchLicenses} />}

          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : licenses.length === 0 ? (
            <EmptyState
              title="No Licenses Issued"
              description="You do not have any internal product license keys. When you purchase a licensed theme or plugin, keys will appear here."
              actionText="Browse Store"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <Card title="License Keys" subtitle={`Total ${licenses.length} license(s)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                      <th className="py-3 px-4">License Key</th>
                      <th className="py-3 px-4">Product</th>
                      <th className="py-3 px-4">Activations / Seats</th>
                      <th className="py-3 px-4">Updates Until</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {licenses.map((lic) => (
                      <tr key={lic.id} className="hover:bg-slate-50/50 transition">
                        <td className="py-3.5 px-4">
                          <div className="font-mono text-xs font-bold text-slate-900">
                            {lic.keyMasked}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            ID: {lic.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-semibold text-slate-700">
                          Product #{lic.productId.slice(0, 8)}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-700">
                          <span className="font-bold text-slate-900">
                            {lic.activeActivations}
                          </span>
                          {" / "}
                          <span>
                            {lic.maxActivations !== null
                              ? lic.maxActivations
                              : "Unlimited"}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          {lic.updatesUntil
                            ? new Date(lic.updatesUntil).toLocaleDateString()
                            : "Lifetime"}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={lic.status} />
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <Link href={`/licenses/${lic.id}`}>
                            <Button variant="outline" size="sm">
                              Manage Key 🔑
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
