"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { TableSkeleton } from "../components/skeleton";
import { ErrorState } from "../components/error-state";
import { Button, Card, Badge } from "@nexus/ui";
import {
  AffiliateDashboardStatsDto,
  AffiliatePayoutDto,
  PayoutMethod,
} from "@nexus/contracts";

export default function AffiliatePage() {
  const { token, user } = useAuth();
  const [stats, setStats] = useState<AffiliateDashboardStatsDto | null>(null);
  const [payouts, setPayouts] = useState<AffiliatePayoutDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Registration form state
  const [regCode, setRegCode] = useState("");
  const [regMethod, setRegMethod] = useState<PayoutMethod>("BANK_TRANSFER");
  const [regDetails, setRegDetails] = useState("");
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // Payout request modal state
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmountMajor, setPayoutAmountMajor] = useState<number>(50);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>("BANK_TRANSFER");
  const [payoutDetails, setPayoutDetails] = useState("");
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutSuccess, setPayoutSuccess] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const fetchAffiliateData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const dashboard = await client.getMyAffiliateDashboard();
      setStats(dashboard);
      try {
        const payoutList = await client.listMyPayouts();
        setPayouts(payoutList || []);
      } catch {
        // Payouts might be empty
        setPayouts([]);
      }
    } catch (err: any) {
      // If 404, user is not registered as affiliate yet
      if (err.message && (err.message.includes("404") || err.message.includes("not found") || err.message.includes("Not Found"))) {
        setStats(null);
      } else {
        setError(err.message || "Failed to load affiliate information");
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAffiliateData();
  }, [fetchAffiliateData]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setRegistering(true);
    setRegError(null);
    try {
      const client = getApiClient(token);
      await client.registerAffiliate({
        code: regCode.trim().toUpperCase(),
        payoutMethod: regMethod,
        payoutDetails: regDetails ? { account: regDetails } : undefined,
      });
      await fetchAffiliateData();
    } catch (err: any) {
      setRegError(err.message || "Failed to join affiliate program");
    } finally {
      setRegistering(false);
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setRequestingPayout(true);
    setPayoutError(null);
    setPayoutSuccess(null);
    try {
      const client = getApiClient(token);
      const amountMinor = Math.round(payoutAmountMajor * 100);
      await client.requestAffiliatePayout({
        amountMinor,
        payoutMethod,
        payoutDetails: payoutDetails ? { account: payoutDetails } : undefined,
      });
      setPayoutSuccess("Payout request submitted successfully!");
      setShowPayoutModal(false);
      await fetchAffiliateData();
    } catch (err: any) {
      setPayoutError(err.message || "Failed to submit payout request");
    } finally {
      setRequestingPayout(false);
    }
  };

  const copyReferralLink = () => {
    if (!stats?.account?.code) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "https://nexustheme.com";
    const refUrl = `${origin}?ref=${stats.account.code}`;
    navigator.clipboard.writeText(refUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const formatCurrency = (minor: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(minor / 100);
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Affiliate & Partner Program
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Earn recurring lifetime commissions by referring creators, agencies, and developers.
              </p>
            </div>
            {stats?.account && (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowPayoutModal(true)}
                  disabled={stats.account.availableBalanceMinor <= 0}
                >
                  Request Payout 💸
                </Button>
              </div>
            )}
          </div>

          {error && <ErrorState message={error} onRetry={fetchAffiliateData} />}
          {payoutSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl flex items-center justify-between">
              <span>{payoutSuccess}</span>
              <button
                onClick={() => setPayoutSuccess(null)}
                className="text-xs text-emerald-600 font-bold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : !stats?.account ? (
            /* Onboarding Registration View */
            <div className="max-w-2xl mx-auto space-y-6 py-4">
              <div className="text-center space-y-2">
                <span className="text-5xl">🤝</span>
                <h2 className="text-2xl font-black text-slate-900">
                  Become a Verified Nexus Partner
                </h2>
                <p className="text-slate-600 text-sm max-w-lg mx-auto">
                  Earn up to 30% commission on every theme, plugin, and membership purchase made through your custom referral link.
                </p>
              </div>

              <Card title="Partner Registration" subtitle="Choose your unique partner code and payout preferences">
                <form onSubmit={handleRegister} className="space-y-4 pt-2">
                  {regError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                      {regError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Preferred Referral Code
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
                        placeholder="e.g. VIPDEAL, NGUYENDEV, WPMASTERY"
                        required
                        minLength={3}
                        maxLength={32}
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      3-32 characters (letters, numbers, hyphen, underscore). Your link will be:{" "}
                      <span className="font-mono text-slate-600">
                        ?ref={regCode || "CODE"}
                      </span>
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Default Payout Method
                      </label>
                      <select
                        value={regMethod}
                        onChange={(e) => setRegMethod(e.target.value as PayoutMethod)}
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                      >
                        <option value="BANK_TRANSFER">Bank Wire / VietQR</option>
                        <option value="PAYPAL">PayPal</option>
                        <option value="CRYPTO">Crypto (USDT TRC20/ERC20)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Payout Account Details
                      </label>
                      <input
                        type="text"
                        value={regDetails}
                        onChange={(e) => setRegDetails(e.target.value)}
                        placeholder="Bank number, PayPal email, or USDT wallet"
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={registering || regCode.trim().length < 3}
                    >
                      {registering ? "Activating Account..." : "Join Partner Program 🚀"}
                    </Button>
                  </div>
                </form>
              </Card>
            </div>
          ) : (
            /* Active Affiliate Dashboard */
            <div className="space-y-6">
              {/* Referral Link & Status Card */}
              <div className="p-6 bg-gradient-to-r from-blue-900 to-[#0037b0] rounded-2xl text-white shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-200">
                      Partner Code
                    </span>
                    <span className="px-2 py-0.5 bg-white/20 rounded-md font-mono font-bold text-sm tracking-wide">
                      {stats.account.code}
                    </span>
                    <Badge variant={stats.account.status === "ACTIVE" ? "success" : "warning"}>
                      {stats.account.status}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-black">
                    Commission Rate: {stats.account.commissionRateBp / 100}% on all orders
                  </h2>
                  <p className="text-xs text-blue-100">
                    Cookie window: 30 days attribution. Anti-fraud self-referral checks enabled.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                  <div className="px-3.5 py-2 bg-white/10 rounded-xl font-mono text-xs text-blue-100 truncate max-w-xs border border-white/20">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}?ref=${stats.account.code}`
                      : `?ref=${stats.account.code}`}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyReferralLink}
                    className="bg-white text-[#0037b0] hover:bg-blue-50 border-white shrink-0 font-bold"
                  >
                    {copied ? "Copied! ✓" : "Copy Link 📋"}
                  </Button>
                </div>
              </div>

              {/* Stats Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
                <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Total Clicks
                  </span>
                  <span className="text-xl font-black text-slate-900">
                    {stats.totalClicks.toLocaleString()}
                  </span>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Conversions
                  </span>
                  <span className="text-xl font-black text-slate-900">
                    {stats.totalReferrals.toLocaleString()}
                  </span>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Conversion Rate
                  </span>
                  <span className="text-xl font-black text-blue-600">
                    {stats.conversionRatePercent.toFixed(1)}%
                  </span>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Pending
                  </span>
                  <span className="text-xl font-black text-amber-600">
                    {formatCurrency(stats.account.pendingBalanceMinor)}
                  </span>
                </div>

                <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 block mb-1">
                    Available
                  </span>
                  <span className="text-xl font-black text-emerald-700">
                    {formatCurrency(stats.account.availableBalanceMinor)}
                  </span>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Withdrawn
                  </span>
                  <span className="text-xl font-black text-slate-700">
                    {formatCurrency(stats.account.withdrawnBalanceMinor)}
                  </span>
                </div>
              </div>

              {/* Referrals & Payouts Lists */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Referrals Table */}
                <Card
                  title="Recent Referrals"
                  subtitle={`${stats.recentReferrals.length} referred order(s)`}
                >
                  {stats.recentReferrals.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No referrals recorded yet. Share your partner link to start earning!
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-wider font-semibold">
                            <th className="py-2.5 px-3">Order</th>
                            <th className="py-2.5 px-3">Order Amount</th>
                            <th className="py-2.5 px-3">Commission</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Mature Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stats.recentReferrals.map((ref) => (
                            <tr key={ref.id} className="hover:bg-slate-50 transition">
                              <td className="py-2.5 px-3 font-mono text-slate-700">
                                #{ref.orderId.slice(0, 8)}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {formatCurrency(ref.orderAmountMinor)}
                              </td>
                              <td className="py-2.5 px-3 font-bold text-emerald-600">
                                +{formatCurrency(ref.commissionAmountMinor)}
                              </td>
                              <td className="py-2.5 px-3">
                                <StatusBadge status={ref.status} />
                              </td>
                              <td className="py-2.5 px-3 text-slate-500">
                                {new Date(ref.matureAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* Payouts Table */}
                <Card
                  title="Payout History"
                  subtitle={`${payouts.length} payout request(s)`}
                >
                  {payouts.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No payout requests yet. Minimum payout is $50.00.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-wider font-semibold">
                            <th className="py-2.5 px-3">ID / Method</th>
                            <th className="py-2.5 px-3">Amount</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Requested At</th>
                            <th className="py-2.5 px-3">Ref Code</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {payouts.map((po) => (
                            <tr key={po.id} className="hover:bg-slate-50 transition">
                              <td className="py-2.5 px-3">
                                <div className="font-mono text-slate-800">
                                  #{po.id.slice(0, 8)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {po.payoutMethod}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-900">
                                {formatCurrency(po.amountMinor)}
                              </td>
                              <td className="py-2.5 px-3">
                                <StatusBadge status={po.status} />
                              </td>
                              <td className="py-2.5 px-3 text-slate-500">
                                {new Date(po.requestedAt).toLocaleDateString()}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-500">
                                {po.referenceCode || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* Request Payout Modal */}
          {showPayoutModal && stats?.account && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-black text-slate-900 text-lg">
                    Request Partner Payout
                  </h3>
                  <button
                    onClick={() => setShowPayoutModal(false)}
                    className="text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ✕
                  </button>
                </div>

                {payoutError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                    {payoutError}
                  </div>
                )}

                <form onSubmit={handleRequestPayout} className="space-y-4">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Available to withdraw:</span>
                    <span className="font-bold text-emerald-600 text-sm">
                      {formatCurrency(stats.account.availableBalanceMinor)}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Withdrawal Amount (USD)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min={50}
                      max={stats.account.availableBalanceMinor / 100}
                      value={payoutAmountMajor}
                      onChange={(e) => setPayoutAmountMajor(Number(e.target.value))}
                      required
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Minimum threshold: $50.00 USD. Minor unit conversion applied automatically.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Payout Method
                    </label>
                    <select
                      value={payoutMethod}
                      onChange={(e) => setPayoutMethod(e.target.value as PayoutMethod)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                    >
                      <option value="BANK_TRANSFER">Bank Wire / VietQR</option>
                      <option value="PAYPAL">PayPal</option>
                      <option value="CRYPTO">Crypto (USDT)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Payout Destination Details
                    </label>
                    <input
                      type="text"
                      value={payoutDetails}
                      onChange={(e) => setPayoutDetails(e.target.value)}
                      placeholder="Account number, bank name, or wallet address"
                      required
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                    />
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPayoutModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={
                        requestingPayout ||
                        payoutAmountMajor < 50 ||
                        payoutAmountMajor * 100 > stats.account.availableBalanceMinor
                      }
                    >
                      {requestingPayout ? "Submitting..." : "Confirm Payout"}
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
