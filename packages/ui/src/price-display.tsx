import React from "react";

export interface PriceDisplayProps {
  amountMinor: number;
  currency?: "USD" | "VND" | string;
  compareAtMinor?: number | null;
  billingInterval?: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "LIFETIME" | string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showSaveBadge?: boolean;
}

export function formatPriceString(amountMinor: number, currency = "USD"): string {
  if (currency === "VND") {
    return `${amountMinor.toLocaleString("vi-VN")} ₫`;
  }
  return `$${(amountMinor / 100).toFixed(2)}`;
}

export function calculateDiscountPercent(amountMinor: number, compareAtMinor: number): number {
  if (compareAtMinor <= amountMinor || compareAtMinor <= 0) return 0;
  return Math.round(((compareAtMinor - amountMinor) / compareAtMinor) * 100);
}

export function PriceDisplay({
  amountMinor,
  currency = "USD",
  compareAtMinor,
  billingInterval,
  size = "md",
  className = "",
  showSaveBadge = true,
}: PriceDisplayProps) {
  const isDiscounted = compareAtMinor != null && compareAtMinor > amountMinor;
  const discountPercent = isDiscounted ? calculateDiscountPercent(amountMinor, compareAtMinor) : 0;

  const sizeClasses = {
    sm: "text-sm",
    md: "text-lg font-semibold",
    lg: "text-2xl font-bold",
    xl: "text-3xl font-extrabold",
  };

  const compareSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
    xl: "text-lg",
  };

  const intervalSuffixes: Record<string, string> = {
    WEEKLY: "/wk",
    MONTHLY: "/mo",
    QUARTERLY: "/qtr",
    YEARLY: "/yr",
  };

  const intervalText = billingInterval && intervalSuffixes[billingInterval] ? intervalSuffixes[billingInterval] : "";

  return (
    <div className={`inline-flex items-baseline gap-2 ${className}`}>
      {/* Current Price */}
      <span className={`${sizeClasses[size]} text-slate-900 tracking-tight font-sans`}>
        {formatPriceString(amountMinor, currency)}
        {intervalText && <span className="text-xs font-normal text-slate-500 ml-0.5">{intervalText}</span>}
      </span>

      {/* Strikethrough Original Price */}
      {isDiscounted && (
        <span className={`${compareSizeClasses[size]} text-slate-400 line-through font-mono`}>
          {formatPriceString(compareAtMinor, currency)}
        </span>
      )}

      {/* Discount Badge */}
      {isDiscounted && showSaveBadge && discountPercent > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
          Save {discountPercent}%
        </span>
      )}
    </div>
  );
}
