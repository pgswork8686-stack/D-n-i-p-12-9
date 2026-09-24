"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { StatusBadge } from "../../components/status-badge";
import { Skeleton } from "../../components/skeleton";
import { ErrorState } from "../../components/error-state";
import { Button } from "@nexus/ui";
import { InvoiceDto } from "@nexus/contracts";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const client = getApiClient(token);
        const inv = await client.getMyInvoice(id);
        setInvoice(inv);
      } catch (err: any) {
        setError(err?.message || "Failed to load invoice details");
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [token, id]);

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (minor: number, currency = "USD") => {
    if (currency === "VND") {
      return `${minor.toLocaleString("vi-VN")} ₫`;
    }
    return `$${(minor / 100).toFixed(2)}`;
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Action Bar (Hidden when printing) */}
          <div className="print:hidden flex items-center justify-between gap-4">
            <Link
              href="/invoices"
              className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              ← Back to Invoices
            </Link>
            <div className="flex items-center gap-2">
              <Button onClick={handlePrint} variant="outline" size="sm">
                🖨️ Print / Save as PDF
              </Button>
            </div>
          </div>

          {/* Error Message */}
          {error && <ErrorState message={error} onRetry={() => router.refresh()} />}

          {/* Skeleton */}
          {loading && !error && (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 space-y-6">
              <Skeleton className="h-10 w-1/3" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
              <Skeleton className="h-48 w-full" />
            </div>
          )}

          {/* Printable Invoice Document */}
          {!loading && !error && invoice && (
            <div
              id="printable-invoice"
              className="bg-white p-8 sm:p-12 rounded-2xl border border-slate-200/90 shadow-sm text-slate-800 print:border-none print:shadow-none print:p-0 print:m-0"
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-200 pb-8">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-lg bg-[#0037b0] text-white flex items-center justify-center font-black text-lg">
                      N
                    </span>
                    <span className="text-xl font-extrabold text-[#0037b0] tracking-tight">
                      NEXUSTHEME
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed font-sans">
                    NexusTheme Digital Commerce Ltd<br />
                    123 Innovation Boulevard, Suite 500<br />
                    Tax ID / EU VAT: EU987654321
                  </p>
                </div>
                <div className="sm:text-right">
                  <h1 className="text-2xl font-bold uppercase tracking-wider text-slate-900">
                    Commercial Invoice
                  </h1>
                  <p className="text-base font-bold text-[#0037b0] font-mono mt-1">
                    {invoice.invoiceNumber}
                  </p>
                  <div className="mt-2 inline-block">
                    <StatusBadge status={invoice.status} />
                  </div>
                </div>
              </div>

              {/* Invoice Meta & Billed To */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 py-8 border-b border-slate-200 text-sm">
                <div>
                  <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Billed To:
                  </h2>
                  <p className="font-bold text-slate-900 text-base">{invoice.customerName}</p>
                  <p className="text-slate-600 font-medium">{invoice.customerEmail}</p>
                  {invoice.customerAddress && (
                    <p className="text-slate-500 whitespace-pre-line mt-1">{invoice.customerAddress}</p>
                  )}
                  {invoice.vatId && (
                    <p className="text-xs font-mono text-slate-600 mt-2">
                      <span className="font-semibold text-slate-700">Customer VAT/Tax ID:</span> {invoice.vatId}
                    </p>
                  )}
                </div>
                <div className="sm:text-right space-y-1.5 text-xs sm:text-sm">
                  <div className="flex justify-between sm:justify-end gap-6">
                    <span className="text-slate-500">Invoice Date:</span>
                    <span className="font-medium text-slate-900">
                      {new Date(invoice.issuedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {invoice.paidAt && (
                    <div className="flex justify-between sm:justify-end gap-6">
                      <span className="text-slate-500">Payment Date:</span>
                      <span className="font-medium text-slate-900">
                        {new Date(invoice.paidAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {invoice.orderId && (
                    <div className="flex justify-between sm:justify-end gap-6">
                      <span className="text-slate-500">Order Reference:</span>
                      <span className="font-mono text-slate-800">#{invoice.orderId}</span>
                    </div>
                  )}
                  <div className="flex justify-between sm:justify-end gap-6">
                    <span className="text-slate-500">Currency:</span>
                    <span className="font-semibold text-slate-900">{invoice.currency}</span>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="py-8 border-b border-slate-200">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-3">Description</th>
                      <th className="pb-3 text-center">Qty</th>
                      <th className="pb-3 text-right">Unit Price</th>
                      <th className="pb-3 text-right">Tax Rate</th>
                      <th className="pb-3 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(invoice.items || []).map((item) => (
                      <tr key={item.id} className="py-4">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          {item.description}
                        </td>
                        <td className="py-3 px-2 text-center text-slate-600">
                          {item.quantity}
                        </td>
                        <td className="py-3 px-2 text-right text-slate-600 font-mono">
                          {formatCurrency(item.unitPriceMinor, invoice.currency)}
                        </td>
                        <td className="py-3 px-2 text-right text-slate-600 text-xs font-mono">
                          {(item.taxRateBasisPoints / 100).toFixed(1)}%
                        </td>
                        <td className="py-3 pl-4 text-right font-semibold text-slate-900 font-mono">
                          {formatCurrency(item.amountMinor, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div className="pt-6 flex justify-end">
                <div className="w-full sm:w-72 space-y-2.5 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-mono font-medium">
                      {formatCurrency(invoice.subtotalMinor, invoice.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>
                      Tax / VAT ({(invoice.taxRateBasisPoints / 100).toFixed(1)}%):
                    </span>
                    <span className="font-mono font-medium">
                      {formatCurrency(invoice.taxAmountMinor, invoice.currency)}
                    </span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between text-base font-bold text-slate-900">
                    <span>Total Paid:</span>
                    <span className="font-mono text-[#0037b0] text-lg">
                      {formatCurrency(invoice.totalAmountMinor, invoice.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Regulatory & Reverse Charge Notice */}
              {invoice.isReverseCharge && (
                <div className="mt-8 p-4 bg-purple-50/70 border border-purple-200 rounded-xl text-xs text-purple-900">
                  <p className="font-bold">EU VAT Reverse Charge Applied</p>
                  <p className="mt-0.5 text-purple-700">
                    Zero-rated cross-border supply of digital services subject to the reverse charge mechanism
                    under Articles 194 and 196 of the EU VAT Directive 2006/112/EC. VAT to be accounted for by the recipient.
                  </p>
                </div>
              )}

              {/* Footer Note */}
              <div className="mt-12 pt-6 border-t border-slate-100 text-center text-xs text-slate-400">
                Thank you for your business. For billing inquiries or questions, contact us via Support Tickets.
              </div>
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
