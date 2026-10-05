"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AnalyticsOverviewPanel, Card } from "@nexus/ui";
import type { AnalyticsCampaignsDto, AnalyticsClientDto, AnalyticsFunnelDto, AnalyticsOverviewDto } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";

const STAGE_LABEL: Record<string, string> = {
  sessions: "Phiên truy cập",
  leads: "Khách tiềm năng",
  qualified_leads: "Đủ điều kiện",
  opportunities: "Cơ hội",
  customers: "Khách hàng",
};

function lastWeek() {
  const to = new Date(Date.now() - 86_400_000);
  const from = new Date(to.getTime() - 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Phase 19 — staff analytics foundation. Tenant filtering is enforced by the API, not here. */
export default function AdminAnalyticsPage() {
  const { token, isLoading } = useAuth();
  const [clients, setClients] = useState<AnalyticsClientDto[]>([]);
  const [clientId, setClientId] = useState("");
  const [range, setRange] = useState(lastWeek);
  const [overview, setOverview] = useState<AnalyticsOverviewDto | null>(null);
  const [campaigns, setCampaigns] = useState<AnalyticsCampaignsDto | null>(null);
  const [funnel, setFunnel] = useState<AnalyticsFunnelDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      if (!isLoading) setError("Vui lòng đăng nhập bằng tài khoản quản trị.");
      return;
    }
    getApiClient(token)
      .listAnalyticsClients()
      .then((list) => {
        setClients(list);
        setClientId((c) => c || list[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, [token, isLoading]);

  const load = useCallback(async () => {
    if (!token || !clientId) return;
    setError(null);
    try {
      const api = getApiClient(token);
      const [o, c, f] = await Promise.all([
        api.getAnalyticsOverview(clientId, range.from, range.to),
        api.getAnalyticsCampaigns(clientId, range.from, range.to),
        api.getAnalyticsFunnel(clientId, range.from, range.to),
      ]);
      setOverview(o);
      setCampaigns(c);
      setFunnel(f);
    } catch (e: any) {
      setError(e.message);
    }
  }, [token, clientId, range]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Phân tích marketing</h1>
          <p className="text-sm text-slate-500">Dữ liệu từ kho analytics; chỉ số được tính ở backend theo một bộ công thức chuẩn.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs font-semibold text-slate-600">
            Khách hàng
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Từ ngày
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Đến ngày
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
      </div>

      {error ? <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div> : null}
      {!clients.length && !error ? <p className="text-sm text-slate-400">Chưa có khách hàng (tenant CLIENT) nào.</p> : null}

      {overview ? <AnalyticsOverviewPanel overview={overview as any} /> : null}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Chiến dịch">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 text-left">
              <tr>
                <th className="py-2">Chiến dịch</th>
                <th className="py-2 text-right">Khách tiềm năng</th>
                <th className="py-2 text-right">CPL</th>
                <th className="py-2 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns?.campaigns.map((c) => (
                <tr key={`${c.channel}/${c.campaignKey}`}>
                  <td className="py-2">
                    <div className="font-medium text-slate-900">{c.campaignName}</div>
                    <div className="text-xs text-slate-400">{c.channel}</div>
                  </td>
                  <td className="py-2 text-right">{c.totals.leads.toLocaleString("vi-VN")}</td>
                  <td className="py-2 text-right">{c.metrics.cpl === null ? "—" : Math.round(c.metrics.cpl).toLocaleString("vi-VN")}</td>
                  <td className="py-2 text-right">{c.metrics.roas === null ? "—" : `${c.metrics.roas.toLocaleString("vi-VN")}×`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Phễu chuyển đổi">
          <div className="space-y-3">
            {funnel?.stages.map((s) => {
              const top = funnel.stages[0]?.value || 1;
              return (
                <div key={s.stage}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                    <span className="text-slate-900 font-semibold">
                      {s.value.toLocaleString("vi-VN")}
                      {s.conversionFromPrevious !== null ? <span className="text-xs text-slate-400 ml-2">({(s.conversionFromPrevious * 100).toFixed(1)}%)</span> : null}
                    </span>
                  </div>
                  <div className="h-2 rounded bg-slate-100 mt-1">
                    <div className="h-2 rounded bg-blue-600" style={{ width: `${Math.max(2, (s.value / top) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
