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
import {
  CustomerLicenseDto,
  CustomerLicenseActivationDto,
} from "@nexus/contracts";

export default function LicenseDetailPage() {
  const params = useParams();
  const licenseId = params?.id as string;
  const { token } = useAuth();
  const [license, setLicense] = useState<CustomerLicenseDto | null>(null);
  const [activations, setActivations] = useState<CustomerLicenseActivationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reveal state
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Deactivation state
  const [deactivatingDomain, setDeactivatingDomain] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const fetchLicenseData = useCallback(async () => {
    if (!token || !licenseId) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const [lic, acts] = await Promise.all([
        client.getLicense(licenseId),
        client.listLicenseActivations(licenseId),
      ]);
      setLicense(lic);
      setActivations(acts || []);
    } catch (err: any) {
      setError(err.message || "Failed to load license details");
    } finally {
      setLoading(false);
    }
  }, [token, licenseId]);

  useEffect(() => {
    fetchLicenseData();
  }, [fetchLicenseData]);

  const handleReveal = async () => {
    if (!token || !licenseId) return;
    setRevealing(true);
    try {
      const client = getApiClient(token);
      const res = await client.revealLicense(licenseId);
      setRevealedKey(res.licenseKey);
    } catch (err: any) {
      setError(err.message || "Failed to reveal license key");
    } finally {
      setRevealing(false);
    }
  };

  const handleCopy = () => {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDeactivate = async (domain: string) => {
    if (!token) return;
    // We need the plaintext key to perform the authoritative deactivation
    let keyToUse = revealedKey;
    if (!keyToUse) {
      try {
        const client = getApiClient(token);
        const res = await client.revealLicense(licenseId);
        keyToUse = res.licenseKey;
        setRevealedKey(res.licenseKey);
      } catch {
        setDeactivateError("Failed to reveal key for deactivation.");
        return;
      }
    }

    setDeactivatingDomain(domain);
    setDeactivateError(null);
    try {
      const client = getApiClient(token);
      await client.deactivateLicense({
        licenseKey: keyToUse,
        domain,
      });
      // Refresh activations and license
      await fetchLicenseData();
    } catch (err: any) {
      setDeactivateError(err.message || "Deactivation failed.");
    } finally {
      setDeactivatingDomain(null);
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-4xl">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/licenses"
                className="text-xs font-bold text-[#0037b0] hover:underline mb-1 inline-block"
              >
                ← Back to All Licenses
              </Link>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                License #{licenseId ? licenseId.slice(0, 8) : "..."}
              </h1>
            </div>
            {license && <StatusBadge status={license.status} />}
          </div>

          {error && <ErrorState message={error} onRetry={fetchLicenseData} />}
          {deactivateError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-semibold">
              ⚠️ {deactivateError}
            </div>
          )}

          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-44 w-full rounded-2xl" />
              <Skeleton className="h-56 w-full rounded-2xl" />
            </div>
          ) : !license ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
              License not found or belongs to another user.
            </div>
          ) : (
            <>
              {/* License Key Card with Secure Reveal */}
              <Card title="License Credentials" subtitle="Masked for security. Reveal to activate on your WordPress site.">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-4">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Product License Key
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="font-mono text-base font-black text-slate-900 bg-white px-4 py-2.5 rounded-xl border border-slate-200 flex-1 truncate">
                        {revealedKey || license.keyMasked}
                      </div>
                      <div className="flex items-center gap-2">
                        {!revealedKey ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleReveal}
                            disabled={revealing}
                          >
                            {revealing ? "Revealing..." : "Reveal Key 👁️"}
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={handleCopy}>
                            {copied ? "Copied! ✓" : "Copy Key 📋"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-200/60 text-xs">
                    <div>
                      <span className="text-slate-400 block mb-0.5">Status:</span>
                      <StatusBadge status={license.status} />
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Active Seats:</span>
                      <span className="font-bold text-slate-800">
                        {license.activeActivations} / {license.maxActivations ?? "Unlimited"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Updates Window:</span>
                      <span className="font-medium text-slate-700">
                        {license.updatesUntil
                          ? new Date(license.updatesUntil).toLocaleDateString()
                          : "Lifetime"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Support Window:</span>
                      <span className="font-medium text-slate-700">
                        {license.supportUntil
                          ? new Date(license.supportUntil).toLocaleDateString()
                          : "Standard"}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Active Activations Card */}
              <Card
                title="Active Domain Activations"
                subtitle="WordPress installations registered to this license key"
              >
                {activations.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    No domains are currently active for this license. Activate this key in your WordPress site settings.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                          <th className="py-3 px-4">Domain</th>
                          <th className="py-3 px-4">Activated At</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activations.map((act) => (
                          <tr key={act.id}>
                            <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                              🌐 {act.domain}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-500">
                              {new Date(act.activatedAt).toLocaleString()}
                            </td>
                            <td className="py-3.5 px-4">
                              <StatusBadge status={act.status} />
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {act.status === "ACTIVE" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeactivate(act.domain)}
                                  disabled={deactivatingDomain === act.domain}
                                  className="text-red-600 hover:bg-red-50 text-xs"
                                >
                                  {deactivatingDomain === act.domain
                                    ? "Deactivating..."
                                    : "Deactivate Domain"}
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
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
