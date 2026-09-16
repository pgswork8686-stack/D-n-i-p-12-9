"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { StatusBadge } from "../../components/status-badge";
import { Skeleton } from "../../components/skeleton";
import { Button, Card } from "@nexus/ui";
import { OrderDto } from "@nexus/contracts";

function PaymentResultContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") || searchParams.get("order_id");
  const { token } = useAuth();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);

  const checkOrderStatus = useCallback(async () => {
    if (!token || !orderId) {
      setLoading(false);
      return;
    }

    try {
      const client = getApiClient(token);
      const res = await client.getOrder(orderId);
      setOrder(res);
    } catch {
      // Keep existing state on transient fetch error
    } finally {
      setLoading(false);
    }
  }, [token, orderId]);

  useEffect(() => {
    checkOrderStatus();
  }, [checkOrderStatus]);

  // Read-only polling: poll order status every 3 seconds up to 10 times if still PENDING_PAYMENT
  useEffect(() => {
    if (order && order.status === "PENDING_PAYMENT" && pollCount < 10) {
      const timer = setTimeout(() => {
        setPollCount((prev) => prev + 1);
        checkOrderStatus();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [order, pollCount, checkOrderStatus]);

  return (
    <div className="space-y-6 max-w-2xl mx-auto py-8">
      <Card title="Payment Status Verification" subtitle="Read-only authoritative state synchronization">
        {loading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !orderId ? (
          <div className="py-6 text-center text-slate-500 text-sm">
            No order identifier provided in return URL.
            <div className="mt-4">
              <Link href="/orders">
                <Button variant="primary" size="sm">
                  View My Orders
                </Button>
              </Link>
            </div>
          </div>
        ) : !order ? (
          <div className="py-6 text-center text-slate-500 text-sm">
            Order not found or still processing.
            <div className="mt-4">
              <Link href="/orders">
                <Button variant="primary" size="sm">
                  View Orders
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {order.status === "PAID" ? (
              <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl">
                  ✓
                </div>
                <h3 className="text-lg font-black text-emerald-900">
                  Payment Confirmed by Backend Authority!
                </h3>
                <p className="text-xs text-emerald-700 max-w-md mx-auto">
                  Your order #{order.id.slice(0, 8)} has been verified and marked PAID by authoritative payment webhook.
                  Your products, license keys, and download grants are now active.
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <Link href="/entitlements">
                    <Button variant="primary" size="sm">
                      Access My Products ✨
                    </Button>
                  </Link>
                  <Link href={`/orders/${order.id}`}>
                    <Button variant="outline" size="sm">
                      View Order Receipt
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-blue-50 border border-blue-200 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 text-[#0037b0] flex items-center justify-center mx-auto text-xl animate-pulse">
                  ⏳
                </div>
                <h3 className="text-lg font-black text-blue-900">
                  Payment Confirmation in Progress
                </h3>
                <p className="text-xs text-blue-700 max-w-md mx-auto">
                  We are awaiting cryptographic confirmation from the payment provider.
                  This page polls the backend authority automatically. Please do not re-submit payment.
                </p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <StatusBadge status={order.status} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkOrderStatus}
                  >
                    Refresh Status 🔄
                  </Button>
                </div>
              </div>
            )}

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="font-bold text-slate-800">Security Boundary Policy:</div>
              <p>
                A browser redirect never marks an order paid. Payment success is solely determined by
                verified webhook events and server-side payment reconciliation.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function PaymentResultPage() {
  return (
    <AuthGuard>
      <PortalShell>
        <Suspense fallback={<Skeleton className="h-60 w-full max-w-2xl mx-auto rounded-2xl" />}>
          <PaymentResultContent />
        </Suspense>
      </PortalShell>
    </AuthGuard>
  );
}
