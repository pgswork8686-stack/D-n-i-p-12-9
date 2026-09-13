"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, Button, Badge } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params?.id as string;

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const getHeaders = () => {
    const devToken =
      typeof window !== "undefined" ? localStorage.getItem("dev_token") : null;
    return {
      "Content-Type": "application/json",
      ...(devToken ? { Authorization: `Bearer ${devToken}` } : {}),
    };
  };

  const fetchOrder = () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/orders/${orderId}`, {
      headers: getHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || `Failed to fetch order (${res.status})`);
        }
        return res.json();
      })
      .then((data) => setOrder(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const computeTestSignature = async (
    externalEventId: string,
    paymentId: string,
    eventType: string,
    secret: string = process.env.NEXT_PUBLIC_TEST_PAYMENT_WEBHOOK_SECRET ||
      "change-me-local-only",
  ): Promise<string> => {
    const enc = new TextEncoder();
    const key = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await window.crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`${externalEventId}:${paymentId}:${eventType}`),
    );
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const handleSimulatePayment = async (
    eventType: "payment.succeeded" | "payment.failed",
  ) => {
    if (!order?.payments || order.payments.length === 0) {
      alert("No pending payment found for this order");
      return;
    }

    const pendingPayment =
      order.payments.find((p: any) => p.status === "PENDING") ||
      order.payments[0];

    setActionLoading(true);
    setFeedback(null);
    try {
      const externalEventId = `sim_evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const signature = await computeTestSignature(
        externalEventId,
        pendingPayment.id,
        eventType,
      );

      const res = await fetch(`${API_URL}/payments/test-callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-signature": signature,
        },
        body: JSON.stringify({
          paymentId: pendingPayment.id,
          externalEventId,
          eventType,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.message || "Payment simulation failed");
      }

      setFeedback(
        `Test payment processed! Status: ${resData.paymentStatus}, Order Status: ${resData.orderStatus}`,
      );
      fetchOrder();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto py-16 px-6 text-center text-gray-500 font-sans">
        Loading order details...
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="max-w-4xl mx-auto py-16 px-6 font-sans text-center">
        <Card className="p-8">
          <h2 className="text-xl font-bold text-red-600">
            Unable to load order
          </h2>
          <p className="text-sm text-gray-500 mt-2">
            {error || "Order not found"}
          </p>
          <Link
            href="/products"
            className="inline-block mt-6 text-blue-600 underline"
          >
            ← Back to Products
          </Link>
        </Card>
      </main>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PAID":
        return <Badge variant="success">PAID</Badge>;
      case "PENDING_PAYMENT":
        return <Badge variant="warning">PENDING PAYMENT</Badge>;
      case "CANCELLED":
        return <Badge variant="error">CANCELLED</Badge>;
      default:
        return <Badge variant="info">{status}</Badge>;
    }
  };

  return (
    <main className="max-w-4xl mx-auto py-12 px-6 font-sans">
      <div className="flex items-center justify-between pb-6 border-b border-gray-200 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
              {order.orderNumber}
            </h1>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-xs text-gray-400">
            Placed on {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        <Link href="/products">
          <Button variant="outline" className="text-xs">
            Back to Catalog
          </Button>
        </Link>
      </div>

      {feedback && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-800 text-sm rounded">
          {feedback}
        </div>
      )}

      <div className="space-y-6">
        {/* Test Payment Simulation Control (Dev / Test Mode) */}
        {order.status === "PENDING_PAYMENT" && (
          <Card className="p-6 bg-amber-50 border-amber-200">
            <h3 className="text-sm font-bold text-amber-900 mb-2">
              🧪 Phase 4 Test Payment Provider Simulator
            </h3>
            <p className="text-xs text-amber-800 mb-4 leading-relaxed">
              Simulate webhook callbacks to verify authoritative payment state
              machine and transactional outbox:
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                onClick={() => handleSimulatePayment("payment.succeeded")}
                disabled={actionLoading}
                className="text-xs bg-green-600 hover:bg-green-700"
              >
                {actionLoading
                  ? "Processing..."
                  : "Simulate Payment Succeeded (Mark PAID)"}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSimulatePayment("payment.failed")}
                disabled={actionLoading}
                className="text-xs border-red-300 text-red-600 hover:bg-red-50"
              >
                Simulate Payment Failed
              </Button>
            </div>
          </Card>
        )}

        {/* Order Items Immutable Snapshot */}
        <Card className="p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">
            Order Items (Immutable Snapshot)
          </h2>
          <div className="divide-y divide-gray-100">
            {order.items?.map((item: any) => (
              <div
                key={item.id}
                className="py-4 flex justify-between items-center text-sm"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    {item.productName}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Variant: {item.variantName} • SKU: {item.sku}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Badge variant="info">{item.productType}</Badge>
                    <Badge variant="warning">{item.fulfillmentType}</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-900">
                    {formatMoney(item.lineTotalAmount, item.currency)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {formatMoney(item.unitAmount, item.currency)} ×{" "}
                    {item.quantity}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-gray-200 mt-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalAmount, order.currency)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Discount</span>
              <span>
                {formatMoney(order.discountAmount || 0, order.currency)}
              </span>
            </div>
            <div className="flex justify-between text-lg font-black text-gray-900 pt-2 border-t border-gray-100">
              <span>Total Authoritative Amount</span>
              <span>{formatMoney(order.totalAmount, order.currency)}</span>
            </div>
          </div>
        </Card>

        {/* Payment History */}
        {order.payments && order.payments.length > 0 && (
          <Card className="p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">
              Payment Transactions
            </h2>
            <div className="space-y-3">
              {order.payments.map((p: any) => (
                <div
                  key={p.id}
                  className="p-3 bg-gray-50 border border-gray-200 rounded flex justify-between items-center text-xs"
                >
                  <div>
                    <span className="font-semibold text-gray-800">
                      Provider: {p.provider}
                    </span>
                    <span className="text-gray-400 ml-2 font-mono">
                      (ID: {p.id.slice(0, 8)}...)
                    </span>
                    <div className="text-gray-500 mt-0.5">
                      Created: {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-900">
                      {formatMoney(p.amount, p.currency)}
                    </span>
                    <Badge
                      variant={
                        p.status === "SUCCEEDED"
                          ? "success"
                          : p.status === "FAILED"
                            ? "error"
                            : "warning"
                      }
                    >
                      {p.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
