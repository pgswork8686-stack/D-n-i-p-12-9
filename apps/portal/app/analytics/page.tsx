"use client";

import React, { useEffect, useState } from "react";
import { AnalyticsOverviewPanel } from "@nexus/ui";
import type { AnalyticsClientDto, AnalyticsOverviewDto } from "@nexus/contracts";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";

/**
 * Phase 19 — customer analytics. Shows only the clients the signed-in user is a member of; the
 * API enforces this (other tenants return 404), the page never filters tenants itself.
 */
export default function PortalAnalyticsPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState<AnalyticsClientDto[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [overview, setOverview] = useState<AnalyticsOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getApiClient(token)
      .listAnalyticsClients()
      .then((list) => {
        setClients(list);
        setClientId(list[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (!token || !clientId) return;
    setOverview(null);
    getApiClient(token)
      .getAnalyticsOverview(clientId)
      .then(setOverview)
      .catch((e) => setError(e.message));
  }, [token, clientId]);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Hiệu quả marketing</h1>
              <p className="text-slate-500 text-sm mt-1">7 ngày gần nhất so với 7 ngày trước đó.</p>
            </div>
            {clients && clients.length > 1 ? (
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {error ? <ErrorState message={error} /> : null}
          {clients && clients.length === 0 ? (
            <EmptyState title="Chưa có dữ liệu marketing" description="Tài khoản của bạn chưa được thêm vào khách hàng nào có dữ liệu phân tích." />
          ) : null}
          {overview ? <AnalyticsOverviewPanel overview={overview as any} /> : null}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
