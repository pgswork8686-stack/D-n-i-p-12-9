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
import { formatMoney } from "@nexus/utils";
import { OrderDto } from "@nexus/contracts";

export default function OrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const res = await client.listOrders({ limit: 50 });
      setOrders(res.items || []);
    } catch (err: any) {
      setError(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                My Orders
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                View purchase history, receipts, and order payment statuses.
              </p>
            </div>
          </div>

          {error && <ErrorState message={error} onRetry={fetchOrders} />}

          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : orders.length === 0 ? (
            <EmptyState
              title="No Orders on Record"
              description="You have not placed any orders yet. Discover WordPress themes and plugins in our store."
              actionText="Explore Marketplace"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <Card title="Order History" subtitle={`Showing ${orders.length} order(s)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                      <th className="py-3 px-4">Order ID</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Items</th>
                      <th className="py-3 px-4">Total Amount</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50/50 transition">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                          #{order.id.slice(0, 8)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {order.items?.length || 0} product(s)
                        </td>
                        <td className="py-3.5 px-4 font-extrabold text-slate-900">
                          {formatMoney(order.totalAmount, order.currency)}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <Link href={`/orders/${order.id}`}>
                            <Button variant="outline" size="sm">
                              View Details →
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
