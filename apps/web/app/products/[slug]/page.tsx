"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Card, Button } from "@nexus/ui";
import { formatMoney } from "@nexus/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function PublicProductDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [product, setProduct] = useState<any>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${API_URL}/products/${slug}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Product not found or currently unavailable.");
        }
        return res.json();
      })
      .then((data) => {
        setProduct(data);
        if (data.variants && data.variants.length > 0) {
          setSelectedVariantId(data.variants[0].id);
        }
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto py-16 px-6 font-sans text-center text-gray-400">
        Loading product information...
      </main>
    );
  }

  if (error || !product) {
    return (
      <main className="max-w-4xl mx-auto py-16 px-6 font-sans text-center">
        <h2 className="text-2xl font-bold text-gray-800">Product Unavailable</h2>
        <p className="text-gray-500 mt-2">{error || "This product does not exist or is not active."}</p>
        <Link href="/products" className="inline-block mt-6 text-blue-600 underline">
          ← Back to All Products
        </Link>
      </main>
    );
  }

  const selectedVariant =
    product.variants?.find((v: any) => v.id === selectedVariantId) ||
    product.variants?.[0];

  return (
    <main className="max-w-5xl mx-auto py-12 px-6 font-sans">
      <Link href="/products" className="text-sm text-gray-500 hover:text-gray-700 block mb-6">
        ← Back to Catalog
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        {/* Main Details */}
        <div className="md:col-span-2 space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
              {product.brand || "Nexus"}
            </span>
            <Badge variant="info">{product.productType}</Badge>
            <Badge variant="warning">{product.fulfillmentType}</Badge>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
            {product.name}
          </h1>

          <p className="text-lg text-gray-600 leading-relaxed">
            {product.shortDescription}
          </p>

          <div className="prose text-sm text-gray-700 pt-6 border-t border-gray-100">
            <h3 className="text-base font-bold text-gray-900 mb-2">Product Overview</h3>
            <p className="whitespace-pre-line leading-relaxed">
              {product.description || "Comprehensive specifications available upon deployment."}
            </p>
          </div>

          {/* Categories */}
          {product.categories?.length > 0 && (
            <div className="pt-4 flex items-center gap-2">
              <span className="text-xs text-gray-400">Categories:</span>
              {product.categories.map((c: any) => (
                <span
                  key={c.id}
                  className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
                >
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Purchase / Variant Card */}
        <div>
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
        </div>
      </div>
    </main>
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
