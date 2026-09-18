"use client";

import React, { useState } from "react";
import { Badge, Card, Button } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

interface ProductVariantSelectorProps {
  product: any;
}

export function ProductVariantSelector({ product }: ProductVariantSelectorProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    product.variants?.[0]?.id || "",
  );

  const selectedVariant =
    product.variants?.find((v: any) => v.id === selectedVariantId) ||
    product.variants?.[0];

  return (
    <Card className="p-6 border border-gray-200 shadow-sm sticky top-8">
      <h3 className="font-bold text-gray-900 text-base mb-4">Choose Variant</h3>

      {/* Variant Options */}
      <div className="space-y-3 mb-6">
        {product.variants?.map((v: any) => {
          const isSelected = v.id === selectedVariant?.id;
          const defaultPrice = v.prices?.[0];

          return (
            <div
              key={v.id}
              onClick={() => setSelectedVariantId(v.id)}
              className={`p-3 rounded-lg border cursor-pointer transition ${
                isSelected
                  ? "border-[#0037b0] bg-blue-50/50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${isSelected ? "text-[#0037b0]" : "text-gray-800"}`}>
                  {v.name}
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {defaultPrice ? formatMoney(defaultPrice.amount, defaultPrice.currency) : "N/A"}
                </span>
              </div>

              {v.licensePlan && (
                <div className="mt-1 text-xs text-gray-500">
                  Up to {v.licensePlan.maxActivations} website(s)
                  {v.licensePlan.isLifetime ? " • Lifetime" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Pricing Breakdown */}
      {selectedVariant && (
        <div className="p-4 bg-gray-50 rounded-lg mb-6 border border-gray-100">
          <span className="text-xs text-gray-500 block mb-1">Total Pricing</span>
          <div className="flex flex-col gap-1">
            {selectedVariant.prices?.map((pr: any) => (
              <div key={pr.id} className="flex justify-between items-center">
                <span className="text-xs font-mono text-gray-400">{pr.currency}:</span>
                <span className="text-lg font-extrabold text-[#0037b0]">
                  {formatMoney(pr.amount, pr.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button variant="primary" className="w-full justify-center text-sm py-2.5">
        {getCtaLabel(product.fulfillmentType, product.productType)}
      </Button>
      <p className="text-xs text-center text-gray-500 mt-3 leading-relaxed">
        {getFulfillmentCopy(product.fulfillmentType)}
      </p>
    </Card>
  );
}

function getFulfillmentCopy(fulfillmentType?: string): string {
  switch (fulfillmentType) {
    case "DIGITAL_DOWNLOAD":
      return "Download access is provided after a valid entitlement is created.";
    case "INTERNAL_LICENSE":
      return "License access is provisioned after order and entitlement processing.";
    case "EXTERNAL_MANAGED":
      return "Activation is managed after purchase. You may be asked to provide the target domain.";
    case "MEMBERSHIP_ACCESS":
      return "Membership access is enabled after successful order processing.";
    case "MANUAL_SERVICE":
      return "Our team will contact you to begin service fulfillment.";
    default:
      return "Fulfillment access is enabled after successful order and entitlement processing.";
  }
}

function getCtaLabel(fulfillmentType?: string, productType?: string): string {
  switch (fulfillmentType) {
    case "DIGITAL_DOWNLOAD":
      return "Download Asset";
    case "INTERNAL_LICENSE":
      return "Purchase License";
    case "EXTERNAL_MANAGED":
      return "Order Managed License";
    case "MEMBERSHIP_ACCESS":
      return "Join Membership";
    case "MANUAL_SERVICE":
      return "Request Service";
    default:
      if (productType === "SERVICE") return "Request Service";
      if (productType === "MEMBERSHIP") return "Join Membership";
      return "Acquire Product";
  }
}
