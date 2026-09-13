"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>(
    isDevAuthToolsEnabled ? "dev-admin-token" : "",
  );

  const fetchOrders = () => {
    if (!authToken) {
      setError("Access Denied (401 Unauthorized): Please provide an authenticated admin token.");
      setLoading(false);
      setOrders([]);
      return;
    }

    setLoading(true);
    fetch(`${API_URL}/admin/orders`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setOrders(data.items || []);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders();
  }, [authToken]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PAID":
        return <Badge variant="success">PAID</Badge>;
      case "PENDING_PAYMENT":
        return <Badge variant="warning">PENDING</Badge>;
      case "CANCELLED":
        return <Badge variant="error">CANCELLED</Badge>;
      default:
        return <Badge variant="info">{status}</Badge>;
    }
  };

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      {isDevAuthToolsEnabled && (
        <div className="mb-6 bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Simulate Token (Dev Only):</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="text-xs py-1 h-auto"
              onClick={() => setAuthToken("dev-admin-token")}
            >
              Set Admin Token
            </Button>
            <Button
              variant="outline"
              className="text-xs py-1 h-auto text-red-600"
              onClick={() => setAuthToken("")}
            >
              Clear Token
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0037b0]">Order Operations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Authoritative orders, payments, and fulfillment states
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin/products">
            <Button variant="outline" className="text-xs">
              Products
            </Button>
          </Link>
          <Button variant="outline" onClick={fetchOrders} className="text-xs">
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading orders...</div>
      ) : error ? (
        <Card className="p-8 text-center bg-red-50 border-red-200 text-red-700">
          <p className="font-bold">Error Accessing Orders</p>
          <p className="text-xs mt-1 text-red-500">{error}</p>
        </Card>
      ) : orders.length === 0 ? (
        <Card className="p-12 text-center text-gray-500">
          <p className="font-semibold text-gray-700">No orders placed yet.</p>
          <p className="text-xs mt-1">Orders created via checkout will appear here.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 font-semibold">Order Number</th>
                <th className="px-6 py-3 font-semibold">Customer ID</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Total</th>
                <th className="px-6 py-3 font-semibold">Items</th>
                <th className="px-6 py-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono font-medium text-blue-600">
                    {o.orderNumber}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-gray-500">
                    {o.userId?.slice(0, 12)}...
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(o.status)}</td>
                  <td className="px-6 py-4 font-bold text-gray-900">
                    {formatMoney(o.totalAmount, o.currency)}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500">
                    {o.items?.length || 0} items
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
