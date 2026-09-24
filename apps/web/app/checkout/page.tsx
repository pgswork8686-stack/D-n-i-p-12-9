"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, Button, Badge, PriceDisplay } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currencyParam = (searchParams.get("currency") as "USD" | "VND") || "USD";

  const [cart, setCart] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Billing form state
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [stateCode, setStateCode] = useState("CA");
  const [isB2B, setIsB2B] = useState(false);
  const [vatId, setVatId] = useState("");

  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Payment method
  const [paymentMethod, setPaymentMethod] = useState<"CARD" | "TEST_PAYMENT" | "WIRE">("CARD");

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

  // Tax calculation estimation
  const estimatedTaxRateBps = useMemo(() => {
    if (isB2B && vatId && vatId.length >= 8) return 0; // Reverse charge
    if (countryCode === "US") {
      if (stateCode === "CA") return 725;
      if (stateCode === "NY") return 887;
      if (stateCode === "TX") return 625;
      return 600;
    }
    if (countryCode === "VN") return 1000;
    if (countryCode === "GB") return 2000;
    if (["DE", "FR", "ES", "IT", "NL"].includes(countryCode)) return 2000;
    return 0;
  }, [countryCode, stateCode, isB2B, vatId]);

  const subtotalMinor = cart?.subtotalAmount ?? 0;
  const discountMinor = Math.round((subtotalMinor * discountPercent) / 100);
  const afterDiscountMinor = Math.max(0, subtotalMinor - discountMinor);
  const estimatedTaxMinor = Math.round((afterDiscountMinor * estimatedTaxRateBps) / 10000);
  const totalMinor = afterDiscountMinor + estimatedTaxMinor;

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError(null);
    const code = couponCode.trim().toUpperCase();
    if (!code) return;

    if (code === "WELCOME10" || code === "NEXUS10") {
      setDiscountPercent(10);
      setCouponApplied(true);
    } else if (code === "PRO20" || code === "DEV20") {
      setDiscountPercent(20);
      setCouponApplied(true);
    } else {
      setCouponError("Invalid or expired promo code");
    }
  };

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
      <main className="max-w-4xl mx-auto py-20 px-6 text-center text-slate-500 font-sans">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0037b0] mb-4" />
        <p className="font-semibold text-slate-700">Securing your checkout session...</p>
      </main>
    );
  }

  if (!cart?.items || cart.items.length === 0) {
    return (
      <main className="max-w-2xl mx-auto py-20 px-6 text-center font-sans">
        <div className="p-8 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-4">
          <span className="text-5xl block">🛒</span>
          <h2 className="text-xl font-bold text-slate-900">Your cart is empty</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Please add items from our digital themes, plugins, or hosting catalog before proceeding.
          </p>
          <div className="pt-2">
            <Link href="/products">
              <Button variant="primary">Browse Catalog →</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Checkout Header */}
      <header className="bg-white border-b border-slate-200 py-4 px-6 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#0037b0] text-white flex items-center justify-center font-black text-lg">
              N
            </span>
            <span className="font-extrabold text-[#0037b0] text-lg tracking-tight">
              NEXUSTHEME
            </span>
          </Link>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span>🔒 256-bit Encrypted Checkout</span>
          </div>
        </div>
      </header>

      {/* Main 2-Column Checkout Layout */}
      <main className="max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-slate-950 tracking-tight">
            1-Step Express Checkout
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Complete your contact details, apply promotional vouchers, and authorize payment.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl font-medium">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Customer Details & Payment */}
          <div className="lg:col-span-7 space-y-6">
            {/* Step 1: Customer & Billing Contact */}
            <div className="p-6 sm:p-8 bg-white rounded-2xl border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                <span className="w-6 h-6 rounded-full bg-[#0037b0] text-white flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <h2 className="text-base font-bold text-slate-900">Contact & Billing Address</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="jane@example.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Country / Region</label>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                  >
                    <option value="US">United States (US)</option>
                    <option value="VN">Vietnam (VN)</option>
                    <option value="GB">United Kingdom (GB)</option>
                    <option value="DE">Germany (DE)</option>
                    <option value="FR">France (FR)</option>
                    <option value="ES">Spain (ES)</option>
                    <option value="IT">Italy (IT)</option>
                    <option value="NL">Netherlands (NL)</option>
                    <option value="AU">Australia (AU)</option>
                    <option value="CA">Canada (CA)</option>
                  </select>
                </div>
                {countryCode === "US" && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">State</label>
                    <select
                      value={stateCode}
                      onChange={(e) => setStateCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                    >
                      <option value="CA">California (7.25%)</option>
                      <option value="NY">New York (8.875%)</option>
                      <option value="TX">Texas (6.25%)</option>
                      <option value="FL">Florida (6.0%)</option>
                      <option value="WA">Washington (6.5%)</option>
                    </select>
                  </div>
                )}
              </div>

              {/* B2B Tax Reverse Charge */}
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={isB2B}
                    onChange={(e) => setIsB2B(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0037b0] focus:ring-blue-500 border-slate-300"
                  />
                  <span>I am purchasing on behalf of a registered business (B2B VAT ID)</span>
                </label>
                {isB2B && (
                  <div className="mt-2.5">
                    <input
                      type="text"
                      placeholder="e.g. DE123456789 or GB123456789"
                      value={vatId}
                      onChange={(e) => setVatId(e.target.value)}
                      className="w-full sm:w-72 px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Validated EU VAT numbers qualify for zero-rated cross-border reverse charge.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Payment Method */}
            <div className="p-6 sm:p-8 bg-white rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                <span className="w-6 h-6 rounded-full bg-[#0037b0] text-white flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <h2 className="text-base font-bold text-slate-900">Payment Authorization</h2>
              </div>

              <div className="space-y-2.5">
                <label
                  onClick={() => setPaymentMethod("CARD")}
                  className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-colors ${
                    paymentMethod === "CARD"
                      ? "border-[#0037b0] bg-blue-50/50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="payment_method"
                      checked={paymentMethod === "CARD"}
                      onChange={() => setPaymentMethod("CARD")}
                      className="text-[#0037b0]"
                    />
                    <div>
                      <span className="font-bold text-sm text-slate-900 block">Credit / Debit Card</span>
                      <span className="text-xs text-slate-500">Stripe Secure Checkout (Visa, Mastercard, Amex)</span>
                    </div>
                  </div>
                  <span className="text-xl">💳</span>
                </label>

                <label
                  onClick={() => setPaymentMethod("TEST_PAYMENT")}
                  className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-colors ${
                    paymentMethod === "TEST_PAYMENT"
                      ? "border-[#0037b0] bg-blue-50/50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="payment_method"
                      checked={paymentMethod === "TEST_PAYMENT"}
                      onChange={() => setPaymentMethod("TEST_PAYMENT")}
                      className="text-[#0037b0]"
                    />
                    <div>
                      <span className="font-bold text-sm text-slate-900 block">Direct Test Gateway (Sandbox)</span>
                      <span className="text-xs text-slate-500">Instant simulated confirmation for QA & developers</span>
                    </div>
                  </div>
                  <span className="text-xl">⚡</span>
                </label>
              </div>

              {/* Security Guarantee Banner */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center gap-3 text-xs text-slate-600">
                <span className="text-lg">🛡️</span>
                <div>
                  <span className="font-semibold text-slate-800">100% Secure Checkout Guarantee:</span> Client authority
                  is strictly zero. All cart calculations and pricing are authoritatively settled by the backend.
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Order Review, Coupon & CTA */}
          <div className="lg:col-span-5 space-y-6">
            <div className="p-6 sm:p-8 bg-white rounded-2xl border border-slate-200/90 shadow-sm space-y-6 sticky top-24">
              <h3 className="font-bold text-base text-slate-900 pb-3 border-b border-slate-100">
                Order Summary ({cart.items.length} items)
              </h3>

              {/* Items List */}
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto pr-1 text-sm">
                {cart.items.map((item: any) => (
                  <div key={item.id} className="py-3 flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{item.productName}</p>
                      <p className="text-xs text-slate-500">
                        {item.variantName} × {item.quantity}
                      </p>
                    </div>
                    <span className="font-bold text-slate-900 font-mono text-sm shrink-0">
                      {currencyParam === "VND"
                        ? `${item.lineTotalAmount.toLocaleString("vi-VN")} ₫`
                        : `$${(item.lineTotalAmount / 100).toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Coupon Voucher Input */}
              <form onSubmit={handleApplyCoupon} className="pt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Promo code (e.g. WELCOME10)"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Apply
                  </button>
                </div>
                {couponApplied && (
                  <p className="text-xs text-emerald-600 font-semibold mt-1">
                    ✓ Promo code applied ({discountPercent}% off subtotal)
                  </p>
                )}
                {couponError && (
                  <p className="text-xs text-rose-500 font-medium mt-1">{couponError}</p>
                )}
              </form>

              {/* Cost Breakdown */}
              <div className="pt-4 border-t border-slate-100 space-y-2.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono font-medium">
                    {currencyParam === "VND"
                      ? `${subtotalMinor.toLocaleString("vi-VN")} ₫`
                      : `$${(subtotalMinor / 100).toFixed(2)}`}
                  </span>
                </div>

                {discountMinor > 0 && (
                  <div className="flex justify-between text-emerald-600 font-medium">
                    <span>Discount ({discountPercent}%)</span>
                    <span className="font-mono">
                      -{currencyParam === "VND"
                        ? `${discountMinor.toLocaleString("vi-VN")} ₫`
                        : `$${(discountMinor / 100).toFixed(2)}`}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-slate-600">
                  <span>
                    Tax / VAT ({(estimatedTaxRateBps / 100).toFixed(1)}%)
                  </span>
                  <span className="font-mono font-medium">
                    {currencyParam === "VND"
                      ? `${estimatedTaxMinor.toLocaleString("vi-VN")} ₫`
                      : `$${(estimatedTaxMinor / 100).toFixed(2)}`}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="text-base font-bold text-slate-900">Total Due</span>
                  <span className="text-2xl font-black text-[#0037b0] font-mono">
                    {currencyParam === "VND"
                      ? `${totalMinor.toLocaleString("vi-VN")} ₫`
                      : `$${(totalMinor / 100).toFixed(2)}`}
                  </span>
                </div>
              </div>

              {/* Complete Order Action */}
              <Button
                variant="primary"
                onClick={handlePlaceOrder}
                disabled={submitting}
                className="w-full py-4 text-base font-extrabold rounded-xl shadow-lg hover:shadow-xl transition-all"
              >
                {submitting ? "Securing Order..." : "Complete Secure Order →"}
              </Button>

              <div className="text-center">
                <Link href="/cart" className="text-xs text-slate-500 hover:text-slate-800 font-medium">
                  ← Edit items in cart
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <React.Suspense
      fallback={
        <main className="max-w-4xl mx-auto py-20 px-6 text-center text-slate-500 font-sans">
          Loading express checkout...
        </main>
      }
    >
      <CheckoutContent />
    </React.Suspense>
  );
}
