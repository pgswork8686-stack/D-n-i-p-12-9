"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, Button } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function CartPage() {
  const [cart, setCart] = useState<any>(null);
  const [currency, setCurrency] = useState<"USD" | "VND">("USD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // In dev / test environment, pass dev customer token if available
  const getHeaders = () => {
    const devToken = typeof window !== "undefined" ? localStorage.getItem("dev_token") : null;
    return {
      "Content-Type": "application/json",
      ...(devToken ? { Authorization: `Bearer ${devToken}` } : {}),
    };
  };

  const fetchCart = (curr = currency) => {
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/cart?currency=${curr}`, {
      headers: getHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || `Failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setCart(data);
      })
      .catch((err) => {
        console.error("Failed to load cart:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCart(currency);
  }, [currency]);

  const handleUpdateQuantity = async (itemId: string, newQty: number) => {
    try {
      const res = await fetch(`${API_URL}/cart/items/${itemId}?currency=${currency}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ quantity: newQty }),
      });
      if (!res.ok) throw new Error("Failed to update quantity");
      const updated = await res.json();
      setCart(updated);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      const res = await fetch(`${API_URL}/cart/items/${itemId}?currency=${currency}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error("Failed to remove item");
      const updated = await res.json();
      setCart(updated);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleClearCart = async () => {
    try {
      const res = await fetch(`${API_URL}/cart`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error("Failed to clear cart");
      fetchCart(currency);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <main className="max-w-4xl mx-auto py-12 px-6 font-sans">
      <div className="flex items-center justify-between pb-6 border-b border-gray-200 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0037b0]">Shopping Cart</h1>
          <p className="text-sm text-gray-500 mt-1">
            Authoritative backend repricing active
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-gray-600">Currency:</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "USD" | "VND")}
            className="text-xs font-medium bg-gray-50 border border-gray-300 rounded px-2 py-1 text-gray-700"
          >
            <option value="USD">USD ($)</option>
            <option value="VND">VND (₫)</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading cart...</div>
      ) : error ? (
        <Card className="p-8 text-center text-red-600">
          <p className="font-semibold">Unable to load cart</p>
          <p className="text-xs mt-1 text-gray-500">{error}</p>
        </Card>
      ) : !cart?.items || cart.items.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-lg font-semibold text-gray-700 mb-2">Your cart is empty</p>
          <p className="text-sm text-gray-500 mb-6">
            Browse our catalog to add digital products, licenses, and assets.
          </p>
          <Link href="/products">
            <Button variant="primary">Browse Catalog</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            {cart.items.map((item: any) => (
              <Card key={item.id} className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-900">{item.productName}</h3>
                  <p className="text-xs text-gray-500">
                    Variant: {item.variantName} ({item.sku})
                  </p>
                  <p className="text-xs font-semibold text-gray-700 mt-1">
                    {formatMoney(item.unitAmount, item.currency)} each
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center border border-gray-200 rounded">
                    <button
                      onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                      className="px-2.5 py-1 text-gray-600 hover:bg-gray-100"
                    >
                      -
                    </button>
                    <span className="px-3 py-1 text-sm font-semibold">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                      className="px-2.5 py-1 text-gray-600 hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right min-w-[100px]">
                    <div className="font-bold text-gray-900">
                      {formatMoney(item.lineTotalAmount, item.currency)}
                    </div>
                    <button
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-xs text-red-500 hover:text-red-700 mt-1"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="flex justify-between items-center pt-4">
            <Button variant="outline" onClick={handleClearCart} className="text-xs">
              Clear Cart
            </Button>
            <div className="text-right">
              <div className="text-sm text-gray-500">Authoritative Subtotal:</div>
              <div className="text-2xl font-black text-gray-900">
                {formatMoney(cart.subtotalAmount, cart.currency)}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
            <Link href="/products">
              <Button variant="outline">Continue Shopping</Button>
            </Link>
            <Link href={`/checkout?currency=${currency}`}>
              <Button variant="primary">Proceed to Checkout →</Button>
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
