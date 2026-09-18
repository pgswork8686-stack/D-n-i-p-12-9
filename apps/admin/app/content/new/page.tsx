"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function NewContentPage() {
  const router = useRouter();
  const [authToken, setAuthToken] = useState<string>(
    isDevAuthToolsEnabled ? "dev-admin-token" : "",
  );
  const [categories, setCategories] = useState<any[]>([]);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("ARTICLE");
  const [status, setStatus] = useState("DRAFT");
  const [categoryId, setCategoryId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // SEO fields
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [featuredImageUrl, setFeaturedImageUrl] = useState("");
  const [featuredImageAlt, setFeaturedImageAlt] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_URL}/admin/content/categories`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then((res) => res.json())
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, [authToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) {
      setError("Unauthorized. Please provide an authenticated admin token.");
      return;
    }

    if (!title.trim() || !content.trim()) {
      setError("Title and content are required.");
      return;
    }

    if (status === "SCHEDULED" && !scheduledAt) {
      setError("Scheduled release date is required when status is SCHEDULED.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload: any = {
      title,
      content,
      contentType,
      status,
    };
    if (slug.trim()) payload.slug = slug.trim();
    if (excerpt.trim()) payload.excerpt = excerpt.trim();
    if (categoryId) payload.categoryId = categoryId;
    if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
    if (seoTitle.trim()) payload.seoTitle = seoTitle.trim();
    if (seoDescription.trim()) payload.seoDescription = seoDescription.trim();
    if (canonicalUrl.trim()) payload.canonicalUrl = canonicalUrl.trim();
    if (featuredImageUrl.trim()) payload.featuredImageUrl = featuredImageUrl.trim();
    if (featuredImageAlt.trim()) payload.featuredImageAlt = featuredImageAlt.trim();
    if (ogImageUrl.trim()) payload.ogImageUrl = ogImageUrl.trim();

    try {
      const res = await fetch(`${API_URL}/admin/content/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed to create post (${res.status})`);
      }

      const created = await res.json();
      router.push(`/content/${created.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create content post.");
      setSaving(false);
    }
  };

  return (
    <main className="max-w-4xl mx-auto py-10 px-6 font-sans">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
        <div>
          <Link href="/content" className="text-xs text-[#0037b0] hover:underline font-semibold">
            ← Back to Content List
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Create New Content Post</h1>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs mb-6">
          <strong>Error:</strong> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="Article Essentials">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 10 Best Practices for WooCommerce Scaling"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Custom Slug (optional, auto-generated if blank)
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. 10-best-practices-woocommerce"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value="">-- No Category --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Content Type
                </label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value="ARTICLE">ARTICLE</option>
                  <option value="PAGE">PAGE</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Initial Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value="DRAFT">DRAFT</option>
                  <option value="IDEA">IDEA</option>
                  <option value="AI_DRAFT">AI_DRAFT</option>
                  <option value="REVIEW">REVIEW</option>
                  <option value="SCHEDULED">SCHEDULED</option>
                  <option value="PUBLISHED">PUBLISHED</option>
                </select>
              </div>

              {status === "SCHEDULED" && (
                <div>
                  <label className="block text-xs font-semibold text-amber-700 mb-1">
                    Scheduled At <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Excerpt / Summary
              </label>
              <textarea
                rows={2}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Brief summary for listings and search engines..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Content Body (HTML or Markdown) <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={12}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your article content here..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono text-xs"
              />
            </div>
          </div>
        </Card>

        <Card title="SEO & OpenGraph Metadata">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Custom SEO Title
                </label>
                <input
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="Defaults to post title if blank"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Canonical URL
                </label>
                <input
                  type="url"
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  placeholder="https://example.com/original-article"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Meta Description
              </label>
              <textarea
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder="Recommended 120-160 characters for search engine snippets"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Featured Image URL
                </label>
                <input
                  type="url"
                  value={featuredImageUrl}
                  onChange={(e) => setFeaturedImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Featured Image Alt Text
                </label>
                <input
                  type="text"
                  value={featuredImageAlt}
                  onChange={(e) => setFeaturedImageAlt(e.target.value)}
                  placeholder="Descriptive alt text for accessibility & SEO"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href="/content">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Create Post"}
          </Button>
        </div>
      </form>
    </main>
  );
}
