"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const PRODUCT_TYPES = [
  "DOWNLOADABLE_ASSET",
  "LICENSED_SOFTWARE",
  "EXTERNAL_MANAGED_LICENSE",
  "MEMBERSHIP",
  "SUBSCRIPTION",
  "SERVICE",
];

const FULFILLMENT_TYPES = [
  "DIGITAL_DOWNLOAD",
  "INTERNAL_LICENSE",
  "EXTERNAL_MANAGED",
  "MEMBERSHIP_ACCESS",
  "MANUAL_SERVICE",
];

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function NewProductPage() {
  const router = useRouter();
  const [authToken, setAuthToken] = useState<string>(
    isDevAuthToolsEnabled ? "dev-admin-token" : "",
  );
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    productType: "DOWNLOADABLE_ASSET",
    fulfillmentType: "DIGITAL_DOWNLOAD",
    status: "DRAFT",
    brand: "",
    shortDescription: "",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const generatedSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug === "" || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ? generatedSlug : prev.slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) {
      setError("Access Denied (401 Unauthorized): Please provide an authenticated admin token or login via Supabase session.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/admin/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Failed to create product (${res.status})`);
      }

      const created = await res.json();
      router.push(`/admin/products/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto py-10 px-6 font-sans">
      {isDevAuthToolsEnabled && (
        <div className="mb-6 bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Simulate Token (Dev Only):</span>
          <div className="flex gap-2">
            <button
              onClick={() => setAuthToken("dev-admin-token")}
              className={`px-2.5 py-1 rounded border font-medium ${authToken === "dev-admin-token" ? "bg-[#0037b0] text-white" : "bg-white text-gray-700"}`}
            >
              Admin Token
            </button>
            <button
              onClick={() => setAuthToken("dev-customer-token")}
              className={`px-2.5 py-1 rounded border font-medium ${authToken === "dev-customer-token" ? "bg-amber-600 text-white" : "bg-white text-gray-700"}`}
            >
              Customer Token (403)
            </button>
            <button
              onClick={() => setAuthToken("")}
              className={`px-2.5 py-1 rounded border font-medium ${!authToken ? "bg-red-600 text-white" : "bg-white text-gray-700"}`}
            >
              No Token (401)
            </button>
          </div>
        </div>
      )}
      <div className="pb-6 border-b border-gray-200 mb-8">
        <Link href="/admin/products" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Products
        </Link>
        <h1 className="text-3xl font-extrabold text-[#0037b0] mt-2">
          Create New Product
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Configure product metadata, fulfillment strategy, and catalog defaults
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 text-sm">
          <strong>Validation Error:</strong> {error}
        </div>
      )}

      <Card className="p-6 border border-gray-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Product Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={handleNameChange}
                placeholder="e.g. Nexus Pro Plugin"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Slug (URL-safe) *
              </label>
              <input
                type="text"
                required
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                title="Must be lowercase alphanumeric with hyphens"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                placeholder="e.g. nexus-pro-plugin"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Product Type *
              </label>
              <select
                value={formData.productType}
                onChange={(e) => setFormData({ ...formData, productType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Fulfillment Type *
              </label>
              <select
                value={formData.fulfillmentType}
                onChange={(e) => setFormData({ ...formData, fulfillmentType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FULFILLMENT_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Initial Status *
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="DRAFT">DRAFT (Hidden)</option>
                <option value="ACTIVE">ACTIVE (Published)</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Brand / Vendor Name
            </label>
            <input
              type="text"
              value={formData.brand}
              onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              placeholder="e.g. NexusTheme or Elementor"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Short Description
            </label>
            <input
              type="text"
              value={formData.shortDescription}
              onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
              placeholder="Brief summary for listings..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Full Description
            </label>
            <textarea
              rows={4}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detailed product information, features, compatibility..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Link href="/admin/products">
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </Link>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Create Product"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
