"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { StatusBadge } from "../../components/status-badge";
import { Skeleton } from "../../components/skeleton";
import { ErrorState } from "../../components/error-state";
import { Button, Card } from "@nexus/ui";
import { EntitlementDto, CustomerProductVersionDto } from "@nexus/contracts";
import { resolveEntitlementActionCta } from "../../lib/portal-actions";

export default function EntitlementDetailPage() {
  const params = useParams();
  const entitlementId = params?.id as string;
  const { token } = useAuth();
  const [entitlement, setEntitlement] = useState<EntitlementDto | null>(null);
  const [versions, setVersions] = useState<CustomerProductVersionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntitlementData = useCallback(async () => {
    if (!token || !entitlementId) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const ent = await client.getEntitlement(entitlementId);
      setEntitlement(ent);

      // Fetch eligible versions if downloadable or internal license
      try {
        const verList = await client.listEntitlementVersions(entitlementId);
        setVersions(verList || []);
      } catch {
        // May not have versions yet or not downloadable
        setVersions([]);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load entitlement details");
    } finally {
      setLoading(false);
    }
  }, [token, entitlementId]);

  useEffect(() => {
    fetchEntitlementData();
  }, [fetchEntitlementData]);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-4xl">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/entitlements"
                className="text-xs font-bold text-[#0037b0] hover:underline mb-1 inline-block"
              >
                ← Back to My Products
              </Link>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Entitlement #{entitlementId ? entitlementId.slice(0, 8) : "..."}
              </h1>
            </div>
            {entitlement && <StatusBadge status={entitlement.status} />}
          </div>

          {error && <ErrorState message={error} onRetry={fetchEntitlementData} />}

          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-44 w-full rounded-2xl" />
              <Skeleton className="h-48 w-full rounded-2xl" />
            </div>
          ) : !entitlement ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
              Entitlement not found or belongs to another user.
            </div>
          ) : (
            <>
              {/* Entitlement Metadata Card */}
              <Card title="Entitlement Overview" subtitle={`Activated on ${new Date(entitlement.activatedAt).toLocaleDateString()}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2 pb-4 border-b border-slate-100 text-sm">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Fulfillment Type
                    </span>
                    <span className="font-extrabold text-slate-900">
                      {entitlement.fulfillmentType}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Updates Window
                    </span>
                    <span className="font-semibold text-slate-800">
                      {entitlement.updatesUntil
                        ? new Date(entitlement.updatesUntil).toLocaleDateString()
                        : "Lifetime Updates"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Support Window
                    </span>
                    <span className="font-semibold text-slate-800">
                      {entitlement.supportUntil
                        ? new Date(entitlement.supportUntil).toLocaleDateString()
                        : "Standard"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Max Activations
                    </span>
                    <span className="font-bold text-slate-800">
                      {entitlement.maxActivations !== null
                        ? `${entitlement.maxActivations} site(s)`
                        : "Unlimited"}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  {(() => {
                    const actionCta = resolveEntitlementActionCta(entitlement.fulfillmentType);
                    if (!actionCta) return null;
                    return (
                      <Link href={actionCta.href}>
                        <Button
                          variant="primary"
                          size="sm"
                          aria-label={
                            entitlement.fulfillmentType === "EXTERNAL_MANAGED"
                              ? "Manage Domain Allocations"
                              : actionCta.label
                          }
                        >
                          {actionCta.label}
                        </Button>
                      </Link>
                    );
                  })()}

                  <Link href="/downloads">
                    <Button variant="outline" size="sm">
                      Go to Downloads Hub ⬇️
                    </Button>
                  </Link>

                  <Link href={`/orders/${entitlement.orderId}`}>
                    <Button variant="ghost" size="sm">
                      View Original Order 📦
                    </Button>
                  </Link>
                </div>
              </Card>

              {/* Eligible Versions List */}
              <Card
                title="Eligible Product Releases"
                subtitle="Versions available under your purchased update window"
              >
                {versions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    No release packages are currently published for this product, or the entitlement is not active.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="py-3 flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="font-bold text-sm text-slate-900">
                            Version {ver.version}
                          </div>
                          <div className="text-xs text-slate-400">
                            Released:{" "}
                            {ver.releasedAt
                              ? new Date(ver.releasedAt).toLocaleDateString()
                              : "N/A"}{" "}
                            • {ver.files?.length || 0} file(s)
                          </div>
                          {ver.releaseNotes && (
                            <p className="text-xs text-slate-600 mt-1 italic">
                              &ldquo;{ver.releaseNotes}&rdquo;
                            </p>
                          )}
                        </div>
                        <Link href="/downloads">
                          <Button variant="outline" size="sm">
                            Download →
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
