"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card, Badge } from "@nexus/ui";
import { InvoiceDto, InvoiceStatus } from "@nexus/contracts";

export default function InvoicesPage() {
  const { token } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const fetchInvoices = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const query = statusFilter !== "ALL" ? { status: statusFilter as InvoiceStatus } : undefined;
      const res = await client.listMyInvoices(query);
      setInvoices(res.items || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const formatCurrency = (minor: number, currency = "USD") => {
    if (currency === "VND") {
      return `${minor.toLocaleString("vi-VN")} ₫`;
    }
    return `$${(minor / 100).toFixed(2)}`;
  };

  const getTaxBadge = (inv: InvoiceDto) => {
    if (inv.isReverseCharge) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
          Reverse Charge (0%)
        </span>
      );
    }
    if (inv.taxRateBasisPoints > 0) {
      const pct = (inv.taxRateBasisPoints / 100).toFixed(1);
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
          Tax ({pct}%)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
        No Tax (0%)
      </span>
    );
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Invoices & Commercial Billing
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Access official VAT/GST commercial receipts and itemized transaction invoices.
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200">
            {["ALL", "PAID", "PENDING_PAYMENT", "CANCELLED", "REFUNDED"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  statusFilter === s
                    ? "bg-[#0037b0] text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {s === "ALL" ? "All Invoices" : s.replace("_", " ")}
              </button>
            ))}
          </div>

          {/* Error Message */}
          {error && <ErrorState message={error} onRetry={fetchInvoices} />}

          {/* Loading Skeleton */}
          {loading && !error && (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && invoices.length === 0 && (
            <EmptyState
              title="No invoices found"
              description={
                statusFilter !== "ALL"
                  ? `You do not have any invoices with status '${statusFilter}'.`
                  : "You do not have any billing invoices yet. Completed orders will automatically generate official commercial receipts."
              }
            />
          )}

          {/* Invoices List */}
          {!loading && !error && invoices.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      <th className="py-3.5 px-4 sm:px-6">Invoice #</th>
                      <th className="py-3.5 px-4">Issued Date</th>
                      <th className="py-3.5 px-4">Order Ref</th>
                      <th className="py-3.5 px-4">Tax / VAT</th>
                      <th className="py-3.5 px-4">Total Amount</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 sm:px-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-4 px-4 sm:px-6">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="font-bold text-[#0037b0] hover:underline"
                          >
                            {inv.invoiceNumber}
                          </Link>
                          {inv.vatId && (
                            <span className="block text-[11px] text-slate-400 font-mono mt-0.5">
                              VAT: {inv.vatId}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-slate-600 whitespace-nowrap">
                          {new Date(inv.issuedAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="py-4 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {inv.orderId ? (
                            <Link href={`/orders/${inv.orderId}`} className="text-blue-600 hover:underline">
                              #{inv.orderId.substring(0, 8)}...
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap">
                          {getTaxBadge(inv)}
                        </td>
                        <td className="py-4 px-4 font-semibold text-slate-900 whitespace-nowrap">
                          {formatCurrency(inv.totalAmountMinor, inv.currency)}
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="py-4 px-4 sm:px-6 text-right whitespace-nowrap">
                          <Link href={`/invoices/${inv.id}`}>
                            <Button size="sm" variant="outline">
                              View Invoice 📄
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
