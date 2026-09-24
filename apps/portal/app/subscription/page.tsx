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
  SubscriptionDto,
  SubscriptionPlanDto,
} from "@nexus/contracts";

export default function SubscriptionPage() {
  const { token } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSubscriptionData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      
      // Fetch public plans
      try {
        const availablePlans = await client.listSubscriptionPlans();
        setPlans(availablePlans || []);
      } catch (e: any) {
        console.error("Failed to load plans", e);
      }

      // Fetch user's active subscription
      try {
        const mySub = await client.getMySubscription();
        setSubscription(mySub);
      } catch (err: any) {
        if (err.message && (err.message.includes("404") || err.message.includes("not found") || err.message.includes("Not Found"))) {
          setSubscription(null);
        } else {
          // Non-404 error
          console.warn("Could not retrieve current subscription:", err.message);
          setSubscription(null);
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to load membership data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSubscriptionData();
  }, [fetchSubscriptionData]);

  const handleSubscribe = async (planId: string) => {
    if (!token) return;
    setActionLoading(`checkout-${planId}`);
    try {
      const client = getApiClient(token);
      const origin = typeof window !== "undefined" ? window.location.href : "https://nexustheme.com";
      const session = await client.createSubscriptionCheckoutSession({
        planId,
        successUrl: `${origin}?session=success`,
        cancelUrl: `${origin}?session=canceled`,
      });

      if (session.sessionUrl) {
        window.location.href = session.sessionUrl;
      }
    } catch (err: any) {
      alert(err.message || "Failed to initiate subscription checkout");
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenCustomerPortal = async () => {
    if (!token) return;
    setActionLoading("portal");
    try {
      const client = getApiClient(token);
      const origin = typeof window !== "undefined" ? window.location.href : "https://nexustheme.com";
      const session = await client.createSubscriptionPortalSession({
        returnUrl: origin,
      });

      if (session.sessionUrl) {
        window.location.href = session.sessionUrl;
      }
    } catch (err: any) {
      alert(err.message || "Failed to open billing portal");
    } finally {
      setActionLoading(null);
    }
  };

  const formatPrice = (minor: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                VIP Membership & Subscriptions
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Access premium themes, unlimited plugin downloads, daily download quotas, and developer licenses.
              </p>
            </div>
            {subscription && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenCustomerPortal}
                disabled={actionLoading === "portal"}
              >
                {actionLoading === "portal" ? "Redirecting..." : "Manage Billing & Invoices 💳"}
              </Button>
            )}
          </div>

          {error && <ErrorState message={error} onRetry={fetchSubscriptionData} />}

          {loading ? (
            <TableSkeleton rows={4} cols={3} />
          ) : (
            <div className="space-y-8">
              {/* Active Subscription View */}
              {subscription ? (
                <div className="space-y-6">
                  <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl text-white shadow-xl relative overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2.5">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-black tracking-wider uppercase bg-amber-400 text-slate-950">
                            {subscription.plan?.tier || "ACTIVE TIER"}
                          </span>
                          <StatusBadge status={subscription.status} />
                          {subscription.cancelAtPeriodEnd && (
                            <span className="text-xs bg-red-500/20 text-red-200 border border-red-500/30 px-2 py-0.5 rounded-md">
                              Cancels at period end
                            </span>
                          )}
                        </div>

                        <h2 className="text-2xl font-black">
                          {subscription.plan?.name || "VIP Subscription"}
                        </h2>

                        <p className="text-sm text-slate-300">
                          Billing Interval:{" "}
                          <span className="font-semibold text-white">
                            {subscription.plan?.interval}
                          </span>{" "}
                          • Renews / Expires:{" "}
                          <span className="font-semibold text-white">
                            {subscription.plan?.interval === "LIFETIME"
                              ? "Never (Lifetime Access)"
                              : new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleOpenCustomerPortal}
                          disabled={actionLoading === "portal"}
                        >
                          Customer Billing Portal ↗
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Daily Quota Card */}
                  <Card
                    title="Daily Download Quota"
                    subtitle="Fair-use automated rate-limiting per calendar day (UTC)"
                  >
                    <div className="space-y-4 pt-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 font-medium">
                          Today&apos;s Downloads:{" "}
                          <span className="font-bold text-slate-900">
                            {subscription.downloadsUsedToday}
                          </span>{" "}
                          / {subscription.dailyDownloadQuota}
                        </span>
                        <span className="font-bold text-[#0037b0]">
                          {subscription.quotaRemainingToday} remaining
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            subscription.downloadsUsedToday >= subscription.dailyDownloadQuota
                              ? "bg-red-500"
                              : subscription.downloadsUsedToday / subscription.dailyDownloadQuota > 0.8
                              ? "bg-amber-500"
                              : "bg-[#0037b0]"
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (subscription.downloadsUsedToday /
                                  (subscription.dailyDownloadQuota || 1)) *
                                  100
                              )
                            )}%`,
                          }}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100">
                        <div>
                          <span className="block font-semibold text-slate-700">Tier Capacity</span>
                          <span>{subscription.dailyDownloadQuota} files / 24 hrs</span>
                        </div>
                        <div>
                          <span className="block font-semibold text-slate-700">Used Today</span>
                          <span>{subscription.downloadsUsedToday} downloads</span>
                        </div>
                        <div>
                          <span className="block font-semibold text-slate-700">Quota Reset</span>
                          <span>Midnight UTC (00:00:00)</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              ) : null}

              {/* Plans Section (Available Plans for subscription or upgrade) */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    {subscription ? "Switch or Upgrade Plan" : "Choose Your Membership Plan"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Get instant access to GPL-compliant themes, plugins, and exclusive priority support.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {plans.map((p) => {
                    const isCurrent = subscription?.planId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`rounded-2xl border transition-all p-6 flex flex-col justify-between bg-white ${
                          isCurrent
                            ? "border-blue-600 ring-2 ring-blue-500/20 shadow-md"
                            : "border-slate-200 hover:border-slate-300 shadow-sm"
                        }`}
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 rounded-md">
                              {p.tier}
                            </span>
                            {isCurrent && (
                              <Badge variant="success">Current Plan</Badge>
                            )}
                          </div>

                          <div>
                            <h4 className="text-xl font-bold text-slate-900">{p.name}</h4>
                            {p.description && (
                              <p className="text-xs text-slate-500 mt-1">{p.description}</p>
                            )}
                          </div>

                          <div className="pt-2 pb-4 border-b border-slate-100">
                            <span className="text-3xl font-black text-slate-900">
                              {formatPrice(p.priceMinor, p.currency)}
                            </span>
                            <span className="text-xs text-slate-400 font-medium ml-1">
                              / {p.interval.toLowerCase()}
                            </span>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                              Included Perks:
                            </div>
                            <ul className="text-xs text-slate-600 space-y-1.5">
                              <li className="flex items-center gap-2">
                                <span className="text-emerald-500 font-bold">✓</span>
                                <span>{p.dailyDownloadQuota} downloads per day</span>
                              </li>
                              <li className="flex items-center gap-2">
                                <span className="text-emerald-500 font-bold">✓</span>
                                <span>Up to {p.maxActivationsPerProduct} site activations</span>
                              </li>
                              {p.features?.map((f, i) => (
                                <li key={i} className="flex items-center gap-2">
                                  <span className="text-emerald-500 font-bold">✓</span>
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="pt-6 mt-6 border-t border-slate-100">
                          {isCurrent ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full text-slate-500 border-slate-200"
                              disabled
                            >
                              Active Plan
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              className="w-full font-bold"
                              onClick={() => handleSubscribe(p.id)}
                              disabled={actionLoading === `checkout-${p.id}`}
                            >
                              {actionLoading === `checkout-${p.id}`
                                ? "Opening Checkout..."
                                : "Subscribe Now →"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
