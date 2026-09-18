"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

const STATUS_TRANSITIONS: Record<string, { label: string; target: string; variant: "primary" | "secondary" | "outline" | "danger" }[]> = {
  IDEA: [{ label: "Start Draft", target: "DRAFT", variant: "primary" }],
  DRAFT: [
    { label: "Submit for Review", target: "REVIEW", variant: "primary" },
    { label: "Archive", target: "ARCHIVED", variant: "danger" },
  ],
  AI_DRAFT: [
    { label: "Submit for Review", target: "REVIEW", variant: "primary" },
    { label: "Convert to Manual Draft", target: "DRAFT", variant: "secondary" },
    { label: "Archive", target: "ARCHIVED", variant: "danger" },
  ],
  REVIEW: [
    { label: "🚀 Publish Now", target: "PUBLISHED", variant: "primary" },
    { label: "📅 Schedule Publication", target: "SCHEDULED", variant: "secondary" },
    { label: "Send Back to Draft", target: "DRAFT", variant: "outline" },
    { label: "Archive", target: "ARCHIVED", variant: "danger" },
  ],
  SCHEDULED: [
    { label: "Publish Immediately", target: "PUBLISHED", variant: "primary" },
    { label: "Revert to Draft", target: "DRAFT", variant: "outline" },
    { label: "Archive", target: "ARCHIVED", variant: "danger" },
  ],
  PUBLISHED: [
    { label: "Archive Post", target: "ARCHIVED", variant: "danger" },
  ],
  ARCHIVED: [
    { label: "Restore to Draft", target: "DRAFT", variant: "secondary" },
  ],
};

const STATUS_COLORS: Record<string, "info" | "success" | "warning" | "error"> = {
  IDEA: "info",
  DRAFT: "info",
  AI_DRAFT: "warning",
  REVIEW: "warning",
  SCHEDULED: "warning",
  PUBLISHED: "success",
  ARCHIVED: "error",
};

export default function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [post, setPost] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [authToken, setAuthToken] = useState<string>(
    isDevAuthToolsEnabled ? "dev-admin-token" : "",
  );

  // Form fields
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("ARTICLE");
  const [categoryId, setCategoryId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // SEO fields
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [featuredImageUrl, setFeaturedImageUrl] = useState("");
  const [featuredImageAlt, setFeaturedImageAlt] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");

  // Schedule modal state
  const [scheduleTargetTime, setScheduleTargetTime] = useState("");
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const fetchPostAndCategories = async () => {
    if (!authToken) {
      setError("Unauthorized (401): Please provide an admin auth token.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [postRes, catRes] = await Promise.all([
        fetch(`${API_URL}/admin/content/posts/${id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${API_URL}/admin/content/categories`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if (!postRes.ok) {
        throw new Error(`Failed to load post (status ${postRes.status})`);
      }

      const postData = await postRes.json();
      const catData = catRes.ok ? await catRes.json() : [];

      setPost(postData);
      setCategories(Array.isArray(catData) ? catData : []);

      // Populate form
      setTitle(postData.title || "");
      setSlug(postData.slug || "");
      setExcerpt(postData.excerpt || "");
      setContent(postData.content || "");
      setContentType(postData.contentType || "ARTICLE");
      setCategoryId(postData.categoryId || "");
      setScheduledAt(postData.scheduledAt ? new Date(postData.scheduledAt).toISOString().slice(0, 16) : "");
      setSeoTitle(postData.seoTitle || "");
      setSeoDescription(postData.seoDescription || "");
      setCanonicalUrl(postData.canonicalUrl || "");
      setFeaturedImageUrl(postData.featuredImageUrl || "");
      setFeaturedImageAlt(postData.featuredImageAlt || "");
      setOgImageUrl(postData.ogImageUrl || "");
      setError(null);
    } catch (err: any) {
      setError(err.message || "Error loading post");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPostAndCategories();
  }, [id, authToken]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const payload: any = {
      title,
      slug,
      excerpt: excerpt.trim() || null,
      content,
      contentType,
      categoryId: categoryId || null,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      canonicalUrl: canonicalUrl.trim() || null,
      featuredImageUrl: featuredImageUrl.trim() || null,
      featuredImageAlt: featuredImageAlt.trim() || null,
      ogImageUrl: ogImageUrl.trim() || null,
    };

    if (scheduledAt) {
      payload.scheduledAt = new Date(scheduledAt).toISOString();
    }

    try {
      const res = await fetch(`${API_URL}/admin/content/posts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed to update post (${res.status})`);
      }

      const updated = await res.json();
      setPost(updated);
      setSuccessMsg("Content post updated successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to update post.");
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (targetStatus: string, customScheduledAt?: string) => {
    setTransitioning(true);
    setError(null);
    setSuccessMsg(null);

    const payload: any = { targetStatus };
    if (targetStatus === "SCHEDULED") {
      if (!customScheduledAt) {
        setShowScheduleModal(true);
        setTransitioning(false);
        return;
      }
      payload.scheduledAt = new Date(customScheduledAt).toISOString();
    }

    try {
      const res = await fetch(`${API_URL}/admin/content/posts/${id}/transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Status transition failed (${res.status})`);
      }

      const updated = await res.json();
      setPost(updated);
      setShowScheduleModal(false);
      setSuccessMsg(`Status transitioned to '${targetStatus}' successfully.`);
    } catch (err: any) {
      setError(err.message || "Status transition failed.");
    } finally {
      setTransitioning(false);
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto py-12 px-6 text-sm text-gray-500">Loading post...</div>;
  }

  return (
    <main className="max-w-5xl mx-auto py-10 px-6 font-sans">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
        <div>
          <Link href="/content" className="text-xs text-[#0037b0] hover:underline font-semibold">
            ← Back to Content List
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-gray-900">{post?.title || "Edit Article"}</h1>
            {post && (
              <Badge variant={STATUS_COLORS[post.status] || "info"}>
                {post.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1 font-mono">
            ID: {id} • Reading Time: ~{post?.readingTimeMinutes || 1} min • Created: {new Date(post?.createdAt).toLocaleDateString()}
          </p>
        </div>
        {post?.status === "PUBLISHED" && (
          <a
            href={`http://localhost:3000/blog/${post.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline" size="sm">
              🌐 View Live Post ↗
            </Button>
          </a>
        )}
      </div>

      {/* Workflow Transition Action Bar */}
      {post && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-900">
              Workflow Lifecycle Action
            </span>
            <p className="text-xs text-blue-700 mt-0.5">
              Current state is <strong>{post.status}</strong>. Choose an authoritative state transition:
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(STATUS_TRANSITIONS[post.status] || []).map((action) => (
              <button
                key={action.target}
                disabled={transitioning}
                onClick={() => handleTransition(action.target)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm transition-all ${
                  action.variant === "primary"
                    ? "bg-[#0037b0] text-white hover:bg-blue-800"
                    : action.variant === "secondary"
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : action.variant === "danger"
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Schedule Post Publication</h3>
            <p className="text-xs text-gray-600">
              Select a future release timestamp. The background worker will automatically publish this article when the scheduled time is reached.
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Release Date & Time (Future)
              </label>
              <input
                type="datetime-local"
                value={scheduleTargetTime}
                onChange={(e) => setScheduleTargetTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!scheduleTargetTime}
                onClick={() => handleTransition("SCHEDULED", scheduleTargetTime)}
              >
                Confirm Schedule
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs mb-6">
          <strong>Error:</strong> {error}
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs mb-6">
          ✓ {successMsg}
        </div>
      )}

      <form onSubmit={handleUpdate} className="space-y-6">
        <Card title="Article Content">
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  URL Slug
                </label>
                <input
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              {post?.status === "SCHEDULED" && (
                <div>
                  <label className="block text-xs font-semibold text-amber-700 mb-1">
                    Scheduled At (Worker auto-publishes)
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Excerpt
              </label>
              <textarea
                rows={2}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Content Body (HTML or Markdown) <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={14}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono text-xs"
              />
            </div>
          </div>
        </Card>

        <Card title="SEO & Canonical Configuration">
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
                  placeholder="https://..."
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href="/content">
            <Button type="button" variant="outline">
              Close
            </Button>
          </Link>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving Changes..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </main>
  );
}
