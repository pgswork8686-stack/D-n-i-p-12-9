"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, Button, Badge } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currencyParam = (searchParams.get("currency") as "USD" | "VND") || "USD";

  const [cart, setCart] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = () => {
    const devToken = typeof window !== "undefined" ? localStorage.getItem("dev_token") : null;
    return {
      "Content-Type": "application/json",
      ...(devToken ? { Authorization: `Bearer ${devToken}` } : {}),
    };
  };

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/cart?currency=${currencyParam}`, {
      headers: getHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || "Failed to load cart");
        }
        return res.json();
      })
      .then((data) => {
        setCart(data);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [currencyParam]);

  const handlePlaceOrder = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/checkout`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          currency: currencyParam,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Checkout failed (${res.status})`);
      }

      const checkoutResponse = await res.json();
      router.push(`/orders/${checkoutResponse.order.id}`);
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto py-16 px-6 text-center text-gray-500">
        Preparing authoritative checkout...
      </main>
    );
  }

  if (!cart?.items || cart.items.length === 0) {
    return (
      <main className="max-w-3xl mx-auto py-16 px-6 text-center font-sans">
        <Card className="p-8">
          <h2 className="text-xl font-bold text-gray-800">Your cart is empty</h2>
          <p className="text-sm text-gray-500 mt-2 mb-6">
            Please add items to your cart before proceeding to checkout.
          </p>
          <Link href="/products">
            <Button variant="primary">Browse Catalog</Button>
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto py-12 px-6 font-sans">
      <div className="pb-6 border-b border-gray-200 mb-8">
        <h1 className="text-3xl font-extrabold text-[#0037b0]">Order Checkout</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review your items and proceed with payment
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Items in Order</h2>
          <div className="divide-y divide-gray-100">
            {cart.items.map((item: any) => (
              <div key={item.id} className="py-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-semibold text-gray-900">{item.productName}</div>
                  <div className="text-xs text-gray-500">
                    {item.variantName} × {item.quantity}
                  </div>
                </div>
                <div className="font-bold text-gray-800">
                  {formatMoney(item.lineTotalAmount, item.currency)}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-gray-200 mt-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{formatMoney(cart.subtotalAmount, cart.currency)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Discount</span>
              <span>{formatMoney(0, cart.currency)}</span>
            </div>
            <div className="flex justify-between text-lg font-black text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span>
              <span>{formatMoney(cart.totalAmount, cart.currency)}</span>
            </div>
          </div>
        </Card>

        <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
          <strong>Backend Repricing Guarantee:</strong> All amounts are verified and calculated
          authoritatively on the server. Client-submitted prices are never trusted.
        </div>

        <div className="flex justify-between items-center pt-4">
          <Link href="/cart">
            <Button variant="outline">← Back to Cart</Button>
          </Link>
          <Button
            variant="primary"
            onClick={handlePlaceOrder}
            disabled={submitting}
            className="px-8 py-3"
          >
            {submitting ? "Placing Order..." : `Place Order (${formatMoney(cart.totalAmount, cart.currency)})`}
          </Button>
        </div>
      </div>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <React.Suspense
      fallback={
        <main className="max-w-3xl mx-auto py-16 px-6 text-center text-gray-500 font-sans">
          Loading checkout...
        </main>
      }
    >
      <CheckoutContent />
    </React.Suspense>
  );
}

