"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { StatusBadge } from "../../components/status-badge";
import { Skeleton } from "../../components/skeleton";
import { ErrorState } from "../../components/error-state";
import { Button, Card } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";
import { OrderDto } from "@nexus/contracts";

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params?.id as string;
  const { token } = useAuth();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingPayment, setRetryingPayment] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const fetchOrderDetail = useCallback(async () => {
    if (!token || !orderId) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const res = await client.getOrder(orderId);
      setOrder(res);
    } catch (err: any) {
      setError(err.message || "Failed to load order detail");
    } finally {
      setLoading(false);
    }
  }, [token, orderId]);

  useEffect(() => {
    fetchOrderDetail();
  }, [fetchOrderDetail]);

  const handleRetryPayment = async () => {
    if (!token || !order) return;
    setRetryingPayment(true);
    setRetryError(null);
    try {
      const client = getApiClient(token);
      const session = await client.createPaymentSession(order.id);
      if (session && session.sessionUrl) {
        window.location.href = session.sessionUrl;
      } else {
        throw new Error("No checkout URL returned from payment provider.");
      }
    } catch (err: any) {
      setRetryError(err.message || "Failed to initiate payment retry");
      setRetryingPayment(false);
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-4xl">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/orders"
                className="text-xs font-bold text-[#0037b0] hover:underline mb-1 inline-block"
              >
                ← Back to All Orders
              </Link>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Order #{orderId ? orderId.slice(0, 8) : "..."}
              </h1>
            </div>
            {order && <StatusBadge status={order.status} />}
          </div>

          {error && <ErrorState message={error} onRetry={fetchOrderDetail} />}

          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-60 w-full rounded-2xl" />
            </div>
          ) : !order ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
              Order not found.
            </div>
          ) : (
            <>
              {/* Payment Status Notice / Authority Banner */}
              <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-100 text-xs text-blue-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>🛡️</span>
                  <span>Backend Payment Authority Guarantee</span>
                </div>
                <p className="text-blue-700 leading-relaxed">
                  Payment transitions are verified strictly by backend Stripe webhooks and reconciliation.
                  Returning from a payment provider will never automatically mark an order paid until
                  cryptographic confirmation is processed by the server.
                </p>
              </div>

              {/* Order Overview Card */}
              <Card title="Order Summary" subtitle={`Created on ${new Date(order.createdAt).toLocaleString()}`}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2 pb-4 border-b border-slate-100 text-sm">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Payment Status
                    </span>
                    <StatusBadge status={order.status} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Currency
                    </span>
                    <span className="font-bold text-slate-800">{order.currency}</span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Total Amount
                    </span>
                    <span className="text-lg font-black text-slate-900">
                      {formatMoney(order.totalAmount, order.currency)}
                    </span>
                  </div>
                </div>

                {/* PENDING_PAYMENT Action Box */}
                {order.status === "PENDING_PAYMENT" && (
                  <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-amber-900">
                          Awaiting Payment Completion
                        </h4>
                        <p className="text-xs text-amber-700 mt-0.5">
                          This order is awaiting payment. You can continue or retry checkout now.
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleRetryPayment}
                        disabled={retryingPayment}
                      >
                        {retryingPayment ? "Connecting to Checkout..." : "Complete Payment Now 💳"}
                      </Button>
                    </div>
                    {retryError && (
                      <p className="text-xs text-red-600 font-semibold">{retryError}</p>
                    )}
                  </div>
                )}
              </Card>

              {/* Immutable Purchased Items Snapshot Card */}
              <Card title="Purchased Items" subtitle="Immutable snapshots recorded at purchase time">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                        <th className="py-3 px-4">Item</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Unit Price</th>
                        <th className="py-3 px-4">Quantity</th>
                        <th className="py-3 px-4 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {order.items?.map((item) => (
                        <tr key={item.id}>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900">{item.productName}</div>
                            <div className="text-xs text-slate-400 font-mono">
                              Variant: {item.variantName} • SKU: {item.sku}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold text-slate-600">
                            {item.productType}
                          </td>
                          <td className="py-3.5 px-4 text-slate-700">
                            {formatMoney(item.unitAmount, order.currency)}
                          </td>
                          <td className="py-3.5 px-4 text-slate-700 font-mono">
                            {item.quantity}
                          </td>
                          <td className="py-3.5 px-4 text-right font-extrabold text-slate-900">
                            {formatMoney(item.lineTotalAmount, order.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <div className="text-right space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                      Order Grand Total
                    </span>
                    <div className="text-2xl font-black text-slate-900">
                      {formatMoney(order.totalAmount, order.currency)}
                    </div>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
