"use client";

import { postStatusLabel } from "../../lib/catalog-labels";
import React, { useEffect, useState, use, useCallback } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import {
  AdminContentPostDto,
  ContentCategoryDto,
  ContentStatus,
  ContentType,
} from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";

const STATUS_TRANSITIONS: Record<
  string,
  { label: string; target: ContentStatus; variant: "primary" | "secondary" | "outline" | "danger" }[]
> = {
  IDEA: [{ label: "Bắt đầu soạn thảo", target: ContentStatus.DRAFT, variant: "primary" }],
  DRAFT: [
    { label: "Gửi duyệt", target: ContentStatus.REVIEW, variant: "primary" },
    { label: "Archive", target: ContentStatus.ARCHIVED, variant: "danger" },
  ],
  AI_DRAFT: [
    { label: "Gửi duyệt", target: ContentStatus.REVIEW, variant: "primary" },
    { label: "Chuyển thành bản nháp thủ công", target: ContentStatus.DRAFT, variant: "secondary" },
    { label: "Archive", target: ContentStatus.ARCHIVED, variant: "danger" },
  ],
  REVIEW: [
    { label: "🚀 Publish Now", target: ContentStatus.PUBLISHED, variant: "primary" },
    { label: "📅 Schedule Publication", target: ContentStatus.SCHEDULED, variant: "secondary" },
    { label: "Trả về bản nháp", target: ContentStatus.DRAFT, variant: "outline" },
    { label: "Archive", target: ContentStatus.ARCHIVED, variant: "danger" },
  ],
  SCHEDULED: [
    { label: "Xuất bản ngay", target: ContentStatus.PUBLISHED, variant: "primary" },
    { label: "Chuyển về bản nháp", target: ContentStatus.DRAFT, variant: "outline" },
    { label: "Archive", target: ContentStatus.ARCHIVED, variant: "danger" },
  ],
  PUBLISHED: [
    { label: "Lưu trữ bài viết", target: ContentStatus.ARCHIVED, variant: "danger" },
  ],
  ARCHIVED: [
    { label: "Khôi phục về bản nháp", target: ContentStatus.DRAFT, variant: "secondary" },
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
  const { token, isLoading: authLoading } = useAuth();

  const [post, setPost] = useState<AdminContentPostDto | null>(null);
  const [categories, setCategories] = useState<ContentCategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState<ContentType>(ContentType.ARTICLE);
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

  const fetchPostAndCategories = useCallback(async () => {
    if (!token) {
      if (!authLoading) {
        setError("Chưa đăng nhập (401): cần tài khoản quản trị.");
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const client = getApiClient(token);
      const [postData, catData] = await Promise.all([
        client.getAdminContentPost(id),
        client.listAdminContentCategories().catch(() => []),
      ]);

      setPost(postData);
      setCategories(Array.isArray(catData) ? catData : []);

      // Populate form
      setTitle(postData.title || "");
      setSlug(postData.slug || "");
      setExcerpt(postData.excerpt || "");
      setContent(postData.content || "");
      setContentType((postData.contentType as ContentType) || ContentType.ARTICLE);
      setCategoryId(postData.categoryId || "");
      setScheduledAt(
        postData.scheduledAt
          ? new Date(postData.scheduledAt).toISOString().slice(0, 16)
          : "",
      );
      setSeoTitle(postData.seoTitle || "");
      setSeoDescription(postData.seoDescription || "");
      setCanonicalUrl(postData.canonicalUrl || "");
      setFeaturedImageUrl(postData.featuredImageUrl || "");
      setFeaturedImageAlt(postData.featuredImageAlt || "");
      setOgImageUrl(postData.ogImageUrl || "");
      setError(null);
    } catch (err: any) {
      setError(err.message || "Không tải được bài viết");
    } finally {
      setLoading(false);
    }
  }, [id, token, authLoading]);

  useEffect(() => {
    if (!authLoading) {
      fetchPostAndCategories();
    }
  }, [authLoading, fetchPostAndCategories]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const payload: any = {
      title: title.trim(),
      slug: slug.trim(),
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

    try {
      const client = getApiClient(token);
      const updated = await client.updateContentPost(id, payload);
      setPost(updated);
      setSuccessMsg("Đã cập nhật bài viết.");
    } catch (err: any) {
      setError(err.message || "Không cập nhật được bài viết.");
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (targetStatus: ContentStatus, customScheduledAt?: string) => {
    if (!token) return;

    setTransitioning(true);
    setError(null);
    setSuccessMsg(null);

    if (targetStatus === ContentStatus.SCHEDULED && !customScheduledAt) {
      setShowScheduleModal(true);
      setTransitioning(false);
      return;
    }

    const payload: any = { targetStatus };
    if (targetStatus === ContentStatus.SCHEDULED && customScheduledAt) {
      payload.scheduledAt = new Date(customScheduledAt).toISOString();
    }

    try {
      const client = getApiClient(token);
      const updated = await client.transitionContentPost(id, payload);
      setPost(updated);
      setShowScheduleModal(false);
      setSuccessMsg(`Đã chuyển trạng thái sang “${postStatusLabel(targetStatus)}”.`);
    } catch (err: any) {
      setError(err.message || "Chuyển trạng thái thất bại.");
    } finally {
      setTransitioning(false);
    }
  };

  if (loading || authLoading) {
    return <div className="max-w-4xl mx-auto py-12 px-6 text-sm text-gray-500">Đang tải bài viết…</div>;
  }

  return (
    <main className="max-w-5xl mx-auto py-10 px-6 font-sans">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
        <div>
          <Link href="/content" className="text-xs text-[#0037b0] hover:underline font-semibold">
            ← Danh sách nội dung
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-gray-900">{post?.title || "Sửa bài viết"}</h1>
            {post && (
              <Badge variant={STATUS_COLORS[post.status] || "info"}>
                {post.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1 font-mono">
            ID: {id} • Reading Time: ~{post?.readingTimeMinutes || 1} min • Created: {post?.createdAt ? new Date(post.createdAt).toLocaleDateString() : ""}
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
              Thao tác theo quy trình
            </span>
            <p className="text-xs text-blue-700 mt-0.5">
              Trạng thái hiện tại: <strong>{postStatusLabel(post.status)}</strong>. Chọn bước chuyển tiếp:
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
            <h3 className="text-lg font-bold text-gray-900">Hẹn giờ xuất bản</h3>
            <p className="text-xs text-gray-600">
              Chọn thời điểm trong tương lai. Hệ thống sẽ tự xuất bản bài viết khi đến giờ.
            </p>
            <div>
              <label htmlFor="ce-1" className="block text-xs font-semibold text-gray-700 mb-1">
                Ngày giờ xuất bản (tương lai)
              </label>
              <input id="ce-1"
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
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!scheduleTargetTime}
                onClick={() => handleTransition(ContentStatus.SCHEDULED, scheduleTargetTime)}
              >
                Xác nhận hẹn giờ
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs mb-6">
          <strong>Lỗi:</strong> {error}
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs mb-6">
          ✓ {successMsg}
        </div>
      )}

      <form onSubmit={handleUpdate} className="space-y-6">
        <Card title="Nội dung bài viết">
          <div className="space-y-4">
            <div>
              <label htmlFor="ce-2" className="block text-xs font-semibold text-gray-700 mb-1">
                Tiêu đề <span className="text-red-500">*</span>
              </label>
              <input id="ce-2"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ce-3" className="block text-xs font-semibold text-gray-700 mb-1">
                  URL Slug
                </label>
                <input id="ce-3"
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label htmlFor="ce-4" className="block text-xs font-semibold text-gray-700 mb-1">
                  Category
                </label>
                <select id="ce-4"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value="">-- Không có danh mục --</option>
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
                <label htmlFor="ce-5" className="block text-xs font-semibold text-gray-700 mb-1">
                  Loại nội dung
                </label>
                <select id="ce-5"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as ContentType)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value={ContentType.ARTICLE}>Bài viết</option>
                  <option value={ContentType.PAGE}>Trang</option>
                </select>
              </div>

              {post?.status === "SCHEDULED" && (
                <div>
                  <label htmlFor="ce-6" className="block text-xs font-semibold text-amber-700 mb-1">
                    Hẹn giờ lúc (tự động xuất bản)
                  </label>
                  <input id="ce-6"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="ce-7" className="block text-xs font-semibold text-gray-700 mb-1">
                Excerpt
              </label>
              <textarea id="ce-7"
                rows={2}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="ce-8" className="block text-xs font-semibold text-gray-700 mb-1">
                Nội dung (HTML hoặc Markdown) <span className="text-red-500">*</span>
              </label>
              <textarea id="ce-8"
                rows={14}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono text-xs"
              />
            </div>
          </div>
        </Card>

        <Card title="SEO & URL chuẩn (canonical)">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ce-9" className="block text-xs font-semibold text-gray-700 mb-1">
                  Tiêu đề SEO tùy chỉnh
                </label>
                <input id="ce-9"
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="ce-10" className="block text-xs font-semibold text-gray-700 mb-1">
                  URL chuẩn (canonical)
                </label>
                <input id="ce-10"
                  type="url"
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="ce-11" className="block text-xs font-semibold text-gray-700 mb-1">
                Mô tả meta
              </label>
              <textarea id="ce-11"
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ce-12" className="block text-xs font-semibold text-gray-700 mb-1">
                  URL ảnh đại diện
                </label>
                <input id="ce-12"
                  type="url"
                  value={featuredImageUrl}
                  onChange={(e) => setFeaturedImageUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="ce-13" className="block text-xs font-semibold text-gray-700 mb-1">
                  Văn bản thay thế của ảnh đại diện
                </label>
                <input id="ce-13"
                  type="text"
                  value={featuredImageAlt}
                  onChange={(e) => setFeaturedImageAlt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="ce-14" className="block text-xs font-semibold text-gray-700 mb-1">
                OpenGraph Image URL
              </label>
              <input id="ce-14"
                type="url"
                value={ogImageUrl}
                onChange={(e) => setOgImageUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href="/content">
            <Button type="button" variant="outline">
              Close
            </Button>
          </Link>
          <Button type="submit" variant="primary" disabled={saving || authLoading}>
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </div>
      </form>
    </main>
  );
}
