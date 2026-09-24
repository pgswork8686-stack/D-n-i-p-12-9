"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card, Badge } from "@nexus/ui";
import {
  HostingAccountDto,
  HostingDnsRecordDto,
  DnsRecordType,
} from "@nexus/contracts";
import { isValidHostingDomain, isValidDnsRecord } from "@nexus/utils";

export default function HostingPortalPage() {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState<HostingAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected account for DNS management
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState<HostingDnsRecordDto[]>([]);
  const [dnsLoading, setDnsLoading] = useState(false);

  // Action status messages
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ssoLoadingId, setSsoLoadingId] = useState<string | null>(null);
  const [purgeLoadingId, setPurgeLoadingId] = useState<string | null>(null);

  // Provisioning form state
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionDomain, setProvisionDomain] = useState("");
  const [provisionPlan, setProvisionPlan] = useState("starter");
  const [provisionSubmitting, setProvisionSubmitting] = useState(false);

  // Add DNS Record form state
  const [recordType, setRecordType] = useState<DnsRecordType>("A");
  const [recordName, setRecordName] = useState("@");
  const [recordContent, setRecordContent] = useState("");
  const [recordTtl, setRecordTtl] = useState(3600);
  const [recordPriority, setRecordPriority] = useState<number | undefined>(undefined);
  const [recordProxied, setRecordProxied] = useState(true);
  const [dnsSubmitting, setDnsSubmitting] = useState(false);

  const fetchAccounts = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const res = await client.listMyHostingAccounts();
      setAccounts(res);
      if (res.length > 0 && !selectedAccountId) {
        setSelectedAccountId(res[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load cloud hosting accounts");
    } finally {
      setLoading(false);
    }
  }, [token, selectedAccountId]);

  const fetchDnsRecords = useCallback(async (accId: string) => {
    if (!token) return;
    setDnsLoading(true);
    try {
      const client = getApiClient(token);
      const records = await client.listHostingDnsRecords(accId);
      setDnsRecords(records);
    } catch (err: any) {
      setActionError(err.message || "Failed to load DNS records");
    } finally {
      setDnsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (selectedAccountId) {
      fetchDnsRecords(selectedAccountId);
    }
  }, [selectedAccountId, fetchDnsRecords]);

  const handleLaunchSso = async (accId: string) => {
    if (!token) return;
    setSsoLoadingId(accId);
    setActionError(null);
    try {
      const client = getApiClient(token);
      const res = await client.generateHostingSsoUrl(accId);
      if (res.ssoUrl) {
        window.open(res.ssoUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to generate single sign-on redirect URL");
    } finally {
      setSsoLoadingId(null);
    }
  };

  const handlePurgeCache = async (accId: string) => {
    if (!token) return;
    setPurgeLoadingId(accId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const client = getApiClient(token);
      await client.purgeHostingCdnCache(accId, { purgeEverything: true });
      setActionSuccess("CDN Edge Cache was completely purged successfully.");
    } catch (err: any) {
      setActionError(err.message || "Failed to purge CDN cache");
    } finally {
      setPurgeLoadingId(null);
    }
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setActionError(null);
    setActionSuccess(null);

    if (!isValidHostingDomain(provisionDomain)) {
      setActionError("Please enter a valid domain name (e.g., example.com or app.example.com)");
      return;
    }

    setProvisionSubmitting(true);
    try {
      const client = getApiClient(token);
      const acc = await client.createHostingAccount({
        domain: provisionDomain.trim().toLowerCase(),
        packagePlan: provisionPlan,
      });
      setShowProvisionModal(false);
      setProvisionDomain("");
      setActionSuccess(`Hosting account for '${acc.domain}' successfully provisioned!`);
      await fetchAccounts();
      setSelectedAccountId(acc.id);
    } catch (err: any) {
      setActionError(err.message || "Failed to provision hosting account");
    } finally {
      setProvisionSubmitting(false);
    }
  };

  const handleAddDnsRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedAccountId) return;
    setActionError(null);
    setActionSuccess(null);

    const validation = isValidDnsRecord(recordType, recordName, recordContent, recordPriority);
    if (!validation.isValid) {
      setActionError(validation.error || "Invalid DNS record payload");
      return;
    }

    setDnsSubmitting(true);
    try {
      const client = getApiClient(token);
      await client.createHostingDnsRecord(selectedAccountId, {
        type: recordType,
        name: recordName.trim(),
        content: recordContent.trim(),
        ttl: Number(recordTtl),
        priority: recordType === "MX" ? Number(recordPriority) : undefined,
        proxied: recordProxied,
      });
      setActionSuccess(`DNS Record '${recordName}' created successfully!`);
      setRecordContent("");
      await fetchDnsRecords(selectedAccountId);
    } catch (err: any) {
      setActionError(err.message || "Failed to add DNS record");
    } finally {
      setDnsSubmitting(false);
    }
  };

  const handleDeleteDnsRecord = async (recordId: string) => {
    if (!token || !selectedAccountId) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      const client = getApiClient(token);
      await client.deleteHostingDnsRecord(selectedAccountId, recordId);
      setActionSuccess("DNS Record deleted successfully.");
      await fetchDnsRecords(selectedAccountId);
    } catch (err: any) {
      setActionError(err.message || "Failed to delete DNS record");
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-8 max-w-6xl mx-auto py-4">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Cloud Hosting & Infrastructure
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Manage your high-performance web hosting containers, cPanel/DirectAdmin SSO, and Cloudflare DNS records.
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setShowProvisionModal(true)}
              className="bg-[#0037b0] hover:bg-[#002b8a] text-white shrink-0"
            >
              + Provision New Hosting
            </Button>
          </div>

          {/* Feedback messages */}
          {actionSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm flex items-center justify-between">
              <span>✓ {actionSuccess}</span>
              <button
                onClick={() => setActionSuccess(null)}
                className="text-emerald-600 hover:text-emerald-900 font-bold ml-4"
              >
                ✕
              </button>
            </div>
          )}

          {actionError && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center justify-between">
              <span>⚠ {actionError}</span>
              <button
                onClick={() => setActionError(null)}
                className="text-rose-600 hover:text-rose-900 font-bold ml-4"
              >
                ✕
              </button>
            </div>
          )}

          {/* Content Loading & Error States */}
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={fetchAccounts} />
          ) : accounts.length === 0 ? (
            <EmptyState
              title="No hosting accounts found"
              description="You have not provisioned any cloud hosting accounts yet. Deploy your first web application or store now."
              actionText="Provision Hosting"
              onAction={() => setShowProvisionModal(true)}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Accounts List (Left 1 col) */}
              <div className="space-y-4 lg:col-span-1">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Your Instances ({accounts.length})
                </h2>
                {accounts.map((acc) => {
                  const isSelected = acc.id === selectedAccountId;
                  const diskPercent = Math.min(
                    100,
                    Math.round((acc.diskUsageMb / acc.diskLimitMb) * 100) || 0,
                  );

                  return (
                    <div
                      key={acc.id}
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-white border-[#0037b0] shadow-md ring-1 ring-[#0037b0]"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-bold text-slate-900 text-base">
                            {acc.domain}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            User: <span className="font-mono text-slate-700">{acc.username}</span> • Plan: {acc.packagePlan}
                          </div>
                        </div>
                        <StatusBadge status={acc.status} />
                      </div>

                      {/* Mini disk progress */}
                      <div className="mt-4">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>Disk Storage</span>
                          <span className="font-medium text-slate-700">
                            {acc.diskUsageMb} MB / {acc.diskLimitMb} MB ({diskPercent}%)
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              diskPercent > 85 ? "bg-rose-500" : "bg-[#0037b0]"
                            }`}
                            style={{ width: `${diskPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Account Detail & DNS Management (Right 2 cols) */}
              {selectedAccount && (
                <div className="space-y-6 lg:col-span-2">
                  {/* Account Overview Card */}
                  <Card className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-bold text-slate-900">
                            {selectedAccount.domain}
                          </h2>
                          <StatusBadge status={selectedAccount.status} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Node: {selectedAccount.server?.name || "Nexus Cloud"} (IP: {selectedAccount.server?.ipAddress || "192.0.2.10"})
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={
                            selectedAccount.status !== "ACTIVE" ||
                            ssoLoadingId === selectedAccount.id
                          }
                          onClick={() => handleLaunchSso(selectedAccount.id)}
                          className="bg-[#0037b0] hover:bg-[#002b8a] text-white"
                        >
                          {ssoLoadingId === selectedAccount.id
                            ? "Connecting..."
                            : "Launch Control Panel ↗"}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            selectedAccount.status !== "ACTIVE" ||
                            purgeLoadingId === selectedAccount.id
                          }
                          onClick={() => handlePurgeCache(selectedAccount.id)}
                        >
                          {purgeLoadingId === selectedAccount.id
                            ? "Purging..."
                            : "Purge CDN Cache"}
                        </Button>
                      </div>
                    </div>

                    {/* Usage Stats Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                        <div className="text-xs font-medium text-slate-500">
                          Disk Space Consumed
                        </div>
                        <div className="text-lg font-bold text-slate-800">
                          {selectedAccount.diskUsageMb} MB{" "}
                          <span className="text-xs font-normal text-slate-400">
                            / {selectedAccount.diskLimitMb} MB
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (selectedAccount.diskUsageMb / selectedAccount.diskLimitMb) *
                                    100,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                        <div className="text-xs font-medium text-slate-500">
                          Monthly Bandwidth Transfer
                        </div>
                        <div className="text-lg font-bold text-slate-800">
                          {selectedAccount.bandwidthUsageMb} MB{" "}
                          <span className="text-xs font-normal text-slate-400">
                            / {selectedAccount.bandwidthLimitMb} MB
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (selectedAccount.bandwidthUsageMb /
                                    selectedAccount.bandwidthLimitMb) *
                                    100,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* DNS Records Table & Manager */}
                  <Card className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-6">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Cloudflare Edge DNS Records
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Zone apex (@) and subdomains routed to your instance.
                        </p>
                      </div>
                      <Badge variant="info">{dnsRecords.length} Records</Badge>
                    </div>

                    {/* New DNS Record Form */}
                    <form
                      onSubmit={handleAddDnsRecord}
                      className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3"
                    >
                      <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        + Add DNS Record
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                        <div className="sm:col-span-1">
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Type
                          </label>
                          <select
                            value={recordType}
                            onChange={(e) => setRecordType(e.target.value as DnsRecordType)}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                          >
                            <option value="A">A</option>
                            <option value="AAAA">AAAA</option>
                            <option value="CNAME">CNAME</option>
                            <option value="TXT">TXT</option>
                            <option value="MX">MX</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Name (@, www, etc.)
                          </label>
                          <input
                            type="text"
                            value={recordName}
                            onChange={(e) => setRecordName(e.target.value)}
                            placeholder="@"
                            required
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Content / Target
                          </label>
                          <input
                            type="text"
                            value={recordContent}
                            onChange={(e) => setRecordContent(e.target.value)}
                            placeholder="192.0.2.1"
                            required
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                          />
                        </div>

                        <div className="sm:col-span-1 flex items-end">
                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            disabled={dnsSubmitting}
                            className="w-full bg-[#0037b0] hover:bg-[#002b8a] text-white text-xs h-[30px]"
                          >
                            {dnsSubmitting ? "..." : "Save"}
                          </Button>
                        </div>
                      </div>

                      {recordType === "MX" && (
                        <div className="max-w-xs">
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Priority (0 - 65535)
                          </label>
                          <input
                            type="number"
                            value={recordPriority || 10}
                            onChange={(e) => setRecordPriority(Number(e.target.value))}
                            className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                          />
                        </div>
                      )}
                    </form>

                    {/* Records List Table */}
                    {dnsLoading ? (
                      <Skeleton className="h-32 w-full rounded-xl" />
                    ) : dnsRecords.length === 0 ? (
                      <div className="text-center py-6 text-sm text-slate-400">
                        No custom DNS records created yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase tracking-wider">
                              <th className="py-2.5 px-3">Type</th>
                              <th className="py-2.5 px-3">Name</th>
                              <th className="py-2.5 px-3">Content</th>
                              <th className="py-2.5 px-3">Proxy</th>
                              <th className="py-2.5 px-3">TTL</th>
                              <th className="py-2.5 px-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {dnsRecords.map((r) => (
                              <tr key={r.id} className="hover:bg-slate-50/70 transition">
                                <td className="py-2.5 px-3 font-bold text-slate-700">{r.type}</td>
                                <td className="py-2.5 px-3 font-mono text-slate-800">{r.name}</td>
                                <td className="py-2.5 px-3 font-mono text-slate-600 truncate max-w-xs">
                                  {r.content}
                                </td>
                                <td className="py-2.5 px-3">
                                  {r.proxied ? (
                                    <span className="text-orange-600 font-medium">⚡ Proxied</span>
                                  ) : (
                                    <span className="text-slate-400">DNS only</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-500">{r.ttl}s</td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    onClick={() => handleDeleteDnsRecord(r.id)}
                                    className="text-rose-600 hover:text-rose-800 font-medium text-xs ml-auto"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Provision Modal */}
          {showProvisionModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900">
                    Provision Cloud Hosting Instance
                  </h3>
                  <button
                    onClick={() => setShowProvisionModal(false)}
                    className="text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleProvisionSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Primary Domain Name *
                    </label>
                    <input
                      type="text"
                      value={provisionDomain}
                      onChange={(e) => setProvisionDomain(e.target.value)}
                      placeholder="myshop.vn or portal.domain.com"
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Enter clean FQDN hostname without protocols (no http/https)
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Package Tier
                    </label>
                    <select
                      value={provisionPlan}
                      onChange={(e) => setProvisionPlan(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                    >
                      <option value="starter">Starter Cloud (5 GB SSD, 50 GB Bandwidth)</option>
                      <option value="pro">Pro Cloud (20 GB NVMe, 200 GB Bandwidth)</option>
                      <option value="enterprise">Enterprise Cloud (50 GB NVMe, Unmetered)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowProvisionModal(false)}
                      disabled={provisionSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={provisionSubmitting}
                      className="bg-[#0037b0] hover:bg-[#002b8a] text-white"
                    >
                      {provisionSubmitting ? "Provisioning..." : "Launch Instance"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
