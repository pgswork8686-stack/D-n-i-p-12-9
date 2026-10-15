"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@nexus/ui";
import { CreateServiceRequest, ServiceCatalogStatus, ServiceDto, ServicePricingMode } from "@nexus/contracts";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { ServicesNav, fieldClass } from "../components/services-nav";

const STATUS_VARIANT: Record<ServiceCatalogStatus, "success" | "warning" | "info"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  ARCHIVED: "info",
};

interface FormState {
  slug: string;
  name: string;
  summary: string;
  description: string;
  features: string;
  processSteps: string;
  imageUrl: string;
  ctaLabel: string;
  pricingMode: ServicePricingMode;
  productId: string;
  status: ServiceCatalogStatus;
  sortOrder: number;
}

const EMPTY_FORM: FormState = {
  slug: "",
  name: "",
  summary: "",
  description: "",
  features: "",
  processSteps: "",
  imageUrl: "",
  ctaLabel: "Nhận báo giá",
  pricingMode: "QUOTE_REQUIRED",
  productId: "",
  status: "DRAFT",
  sortOrder: 0,
};

function toForm(s: ServiceDto): FormState {
  return {
    slug: s.slug,
    name: s.name,
    summary: s.summary,
    description: s.description,
    features: s.features.join("\n"),
    processSteps: s.processSteps.map((p) => `${p.title} | ${p.description}`).join("\n"),
    imageUrl: s.imageUrl || "",
    ctaLabel: s.ctaLabel,
    pricingMode: s.pricingMode,
    productId: "",
    status: s.status,
    sortOrder: s.sortOrder,
  };
}

/** Process steps are edited one per line as "Title | Description". */
function toRequest(f: FormState, isEdit: boolean): CreateServiceRequest {
  const req: CreateServiceRequest = {
    slug: f.slug.trim(),
    name: f.name.trim(),
    summary: f.summary.trim(),
    description: f.description.trim(),
    features: f.features.split("\n").map((s) => s.trim()).filter(Boolean),
    processSteps: f.processSteps
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [title, ...rest] = line.split("|");
        return { title: title.trim(), description: rest.join("|").trim() };
      }),
    imageUrl: f.imageUrl.trim() || null,
    ctaLabel: f.ctaLabel.trim() || "Nhận báo giá",
    pricingMode: f.pricingMode,
    status: f.status,
    sortOrder: Number(f.sortOrder) || 0,
  };
  // Only send productId when the editor typed one; editing keeps the current link otherwise.
  if (f.productId.trim()) req.productId = f.productId.trim();
  else if (!isEdit || f.pricingMode === "QUOTE_REQUIRED") req.productId = null;
  return req;
}

export default function AdminServicesPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceDto | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      if (!authLoading) {
        setError("Access Denied (401 Unauthorized): Please sign in with an authenticated admin account.");
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const res = await getApiClient(token).adminListServices({ limit: 100 });
      setServices(res.items);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load services");
    } finally {
      setLoading(false);
    }
  }, [token, authLoading]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (target: ServiceDto | "new") => {
    setEditing(target);
    setForm(target === "new" ? EMPTY_FORM : toForm(target));
    setFormError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const client = getApiClient(token);
      if (editing === "new") {
        await client.adminCreateService(toRequest(form, false));
      } else {
        await client.adminUpdateService(editing.id, toRequest(form, true));
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      setFormError(err?.message || "Failed to save service");
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      <ServicesNav
        title="Services"
        subtitle="Custom development, AI chatbot and automation services shown on the storefront"
        actions={
          <Button variant="primary" className="text-xs" onClick={() => openEditor("new")}>
            + New service
          </Button>
        }
      />

      {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Pricing</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {services.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-gray-500">{s.sortOrder}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500 font-mono">/{s.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {s.pricingMode === "QUOTE_REQUIRED" ? "Quote required" : `Direct checkout${s.productSlug ? ` (${s.productSlug})` : ""}`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" className="text-xs" onClick={() => openEditor(s)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {services.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    No services yet. Run <code>pnpm db:seed:services</code> or create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="svc-editor-title">
          <form onSubmit={save} className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 id="svc-editor-title" className="text-lg font-bold text-gray-900">
                {editing === "new" ? "New service" : `Edit ${editing.name}`}
              </h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close" className="text-gray-400 hover:text-gray-700 font-bold">
                ✕
              </button>
            </div>
            {formError && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{formError}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-gray-700">
                Name
                <input required maxLength={150} value={form.name} onChange={(e) => set("name", e.target.value)} className={`${fieldClass} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                Slug
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={100}
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value.toLowerCase())}
                  className={`${fieldClass} mt-1 font-mono`}
                />
              </label>
            </div>
            <label className="block text-xs font-semibold text-gray-700">
              Summary
              <input required maxLength={400} value={form.summary} onChange={(e) => set("summary", e.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              Description
              <textarea required rows={4} maxLength={10000} value={form.description} onChange={(e) => set("description", e.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              Features <span className="font-normal text-gray-500">(one per line)</span>
              <textarea rows={4} value={form.features} onChange={(e) => set("features", e.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              Process steps <span className="font-normal text-gray-500">(one per line: Title | Description)</span>
              <textarea rows={4} value={form.processSteps} onChange={(e) => set("processSteps", e.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-gray-700">
                Image URL (https)
                <input type="url" maxLength={500} value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} className={`${fieldClass} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                CTA label
                <input maxLength={40} value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} className={`${fieldClass} mt-1`} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block text-xs font-semibold text-gray-700">
                Pricing
                <select value={form.pricingMode} onChange={(e) => set("pricingMode", e.target.value as ServicePricingMode)} className={`${fieldClass} mt-1`}>
                  <option value="QUOTE_REQUIRED">Quote required</option>
                  <option value="DIRECT_CHECKOUT">Direct checkout (product)</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                Status
                <select value={form.status} onChange={(e) => set("status", e.target.value as ServiceCatalogStatus)} className={`${fieldClass} mt-1`}>
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active (public)</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                Sort order
                <input type="number" min={0} value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} className={`${fieldClass} mt-1`} />
              </label>
            </div>
            {form.pricingMode === "DIRECT_CHECKOUT" && (
              <label className="block text-xs font-semibold text-gray-700">
                Product ID {editing !== "new" && <span className="font-normal text-gray-500">(leave empty to keep the current product)</span>}
                <input value={form.productId} onChange={(e) => set("productId", e.target.value)} className={`${fieldClass} mt-1 font-mono`} />
              </label>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
