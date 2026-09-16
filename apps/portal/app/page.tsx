"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "./context/auth-context";
import { getApiClient } from "./lib/api";
import { AuthGuard } from "./components/auth-guard";
import { PortalShell } from "./components/portal-shell";
import { StatusBadge } from "./components/status-badge";
import { Skeleton } from "./components/skeleton";
import { EmptyState } from "./components/empty-state";
import { ErrorState } from "./components/error-state";
import { Button, Card } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";
import {
  OrderDto,
  EntitlementDto,
  CustomerLicenseDto,
} from "@nexus/contracts";

export default function DashboardPage() {
  const { token, user } = useAuth();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementDto[]>([]);
  const [licenses, setLicenses] = useState<CustomerLicenseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const [ordersRes, entitlementsRes, licensesRes] = await Promise.all([
        client.listOrders({ limit: 5 }),
        client.listEntitlements({ limit: 5 }),
        client.listLicenses(),
      ]);
      setOrders(ordersRes.items || []);
      setEntitlements(entitlementsRes.items || []);
      setLicenses(licensesRes || []);
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-8">
          {/* Header Greeting */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                Welcome back, {user?.profile?.displayName || user?.email?.split("@")[0] || "Customer"} 👋
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Manage your digital products, licenses, downloads, and service allocations.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/downloads">
                <Button variant="primary" size="sm">
                  Downloads Hub ⬇️
                </Button>
              </Link>
            </div>
          </div>

          {error && <ErrorState message={error} onRetry={loadDashboardData} />}

          {/* Metric Stats Cards */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-8 w-1/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Active Products
                  </span>
                  <span className="text-xl">✨</span>
                </div>
                <div className="mt-2 text-3xl font-black text-slate-900">
                  {entitlements.filter((e) => e.status === "ACTIVE").length}
                </div>
              </div>

              <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Total Orders
                  </span>
                  <span className="text-xl">📦</span>
                </div>
                <div className="mt-2 text-3xl font-black text-slate-900">
                  {orders.length}
                </div>
              </div>

              <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Internal Licenses
                  </span>
                  <span className="text-xl">🔑</span>
                </div>
                <div className="mt-2 text-3xl font-black text-slate-900">
                  {licenses.filter((l) => l.status === "ACTIVE").length}
                </div>
              </div>

              <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Downloads Ready
                  </span>
                  <span className="text-xl">⬇️</span>
                </div>
                <div className="mt-2 text-3xl font-black text-slate-900">
                  {
                    entitlements.filter(
                      (e) =>
                        e.status === "ACTIVE" &&
                        e.fulfillmentType !== "EXTERNAL_MANAGED",
                    ).length
                  }
                </div>
              </div>
            </div>
          )}

          {/* Main Dashboard Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Orders Section */}
            <Card
              title="Recent Orders"
              subtitle="Latest transactions and payment statuses"
              headerAction={
                <Link
                  href="/orders"
                  className="text-xs font-semibold text-[#0037b0] hover:underline"
                >
                  View All Orders →
                </Link>
              }
            >
              {loading ? (
                <div className="space-y-3 pt-2">
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ) : orders.length === 0 ? (
                <EmptyState
                  title="No Orders Found"
                  description="You have not placed any orders yet."
                  actionText="Browse Marketplace"
                  actionHref={
                    process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"
                  }
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="py-3.5 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/orders/${order.id}`}
                          className="font-bold text-sm text-slate-900 hover:text-[#0037b0] truncate block"
                        >
                          Order #{order.id.slice(0, 8)}
                        </Link>
                        <div className="text-xs text-slate-400">
                          {new Date(order.createdAt).toLocaleDateString()} •{" "}
                          {order.items?.length || 0} item(s)
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-extrabold text-sm text-slate-900">
                          {formatMoney(order.totalAmount, order.currency)}
                        </span>
                        <StatusBadge status={order.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* My Active Products Section */}
            <Card
              title="My Products & Entitlements"
              subtitle="Active product rights and support windows"
              headerAction={
                <Link
                  href="/entitlements"
                  className="text-xs font-semibold text-[#0037b0] hover:underline"
                >
                  View All Products →
                </Link>
              }
            >
              {loading ? (
                <div className="space-y-3 pt-2">
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ) : entitlements.length === 0 ? (
                <EmptyState
                  title="No Active Entitlements"
                  description="Complete a purchase to unlock licenses and downloads."
                  actionText="Shop Themes & Plugins"
                  actionHref={
                    process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"
                  }
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {entitlements.map((ent) => (
                    <div
                      key={ent.id}
                      className="py-3.5 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/entitlements/${ent.id}`}
                          className="font-bold text-sm text-slate-900 hover:text-[#0037b0] truncate block"
                        >
                          Product {ent.productId.slice(0, 8)}
                        </Link>
                        <div className="text-xs text-slate-400">
                          Fulfillment: {ent.fulfillmentType} • Updates:{" "}
                          {ent.updatesUntil
                            ? new Date(ent.updatesUntil).toLocaleDateString()
                            : "Lifetime"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={ent.status} />
                        <Link href={`/entitlements/${ent.id}`}>
                          <Button variant="outline" size="sm">
                            Manage
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Quick Actions Footer Banner */}
          <div className="p-6 bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-3xl shadow-lg flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="text-lg font-bold">Need assistance with your installation?</h3>
              <p className="text-blue-200 text-sm mt-1">
                Explore guides, verify license domains, or download the latest update packages.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/downloads">
                <Button variant="secondary" size="sm">
                  Get Updates
                </Button>
              </Link>
              <Link href="/licenses">
                <Button variant="outline" size="sm" className="text-white border-white/40 hover:bg-white/10">
                  Manage Keys
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
