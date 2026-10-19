"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@nexus/ui";
import { ContentCategoryDto, ContentStatus, ContentType } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";

export default function NewContentPage() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  const [categories, setCategories] = useState<ContentCategoryDto[]>([]);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState<ContentType>(ContentType.ARTICLE);
  const [status, setStatus] = useState<ContentStatus.DRAFT | ContentStatus.IDEA>(
    ContentStatus.DRAFT,
  );
  const [categoryId, setCategoryId] = useState("");

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
    if (!token) return;
    const client = getApiClient(token);
    client
      .listAdminContentCategories()
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("Chưa đăng nhập. Vui lòng dùng tài khoản quản trị.");
      return;
    }

    if (!title.trim() || !content.trim()) {
      setError("Cần nhập tiêu đề và nội dung.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload: any = {
      title: title.trim(),
      content: content.trim(),
      contentType,
      status,
    };
    if (slug.trim()) payload.slug = slug.trim();
    if (excerpt.trim()) payload.excerpt = excerpt.trim();
    if (categoryId) payload.categoryId = categoryId;
    if (seoTitle.trim()) payload.seoTitle = seoTitle.trim();
    if (seoDescription.trim()) payload.seoDescription = seoDescription.trim();
    if (canonicalUrl.trim()) payload.canonicalUrl = canonicalUrl.trim();
    if (featuredImageUrl.trim()) payload.featuredImageUrl = featuredImageUrl.trim();
    if (featuredImageAlt.trim()) payload.featuredImageAlt = featuredImageAlt.trim();
    if (ogImageUrl.trim()) payload.ogImageUrl = ogImageUrl.trim();

    try {
      const client = getApiClient(token);
      const created = await client.createContentPost(payload);
      router.push(`/content/${created.id}`);
    } catch (err: any) {
      setError(err.message || "Không tạo được bài viết.");
      setSaving(false);
    }
  };

  return (
    <main className="max-w-4xl mx-auto py-10 px-6 font-sans">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
        <div>
          <Link href="/content" className="text-xs text-[#0037b0] hover:underline font-semibold">
            ← Danh sách nội dung
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Tạo bài viết mới</h1>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs mb-6">
          <strong>Lỗi:</strong> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="Thông tin chính">
          <div className="space-y-4">
            <div>
              <label htmlFor="cn-1" className="block text-xs font-semibold text-gray-700 mb-1">
                Tiêu đề <span className="text-red-500">*</span>
              </label>
              <input id="cn-1"
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
                <label htmlFor="cn-2" className="block text-xs font-semibold text-gray-700 mb-1">
                  Slug tùy chỉnh (không bắt buộc, tự tạo nếu để trống)
                </label>
                <input id="cn-2"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. 10-best-practices-woocommerce"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label htmlFor="cn-3" className="block text-xs font-semibold text-gray-700 mb-1">
                  Category
                </label>
                <select id="cn-3"
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
                <label htmlFor="cn-4" className="block text-xs font-semibold text-gray-700 mb-1">
                  Loại nội dung
                </label>
                <select id="cn-4"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as ContentType)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value={ContentType.ARTICLE}>Bài viết</option>
                  <option value={ContentType.PAGE}>Trang</option>
                </select>
              </div>

              <div>
                <label htmlFor="cn-5" className="block text-xs font-semibold text-gray-700 mb-1">
                  Trạng thái ban đầu
                </label>
                <select id="cn-5"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as ContentStatus.DRAFT | ContentStatus.IDEA)
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none bg-white"
                >
                  <option value={ContentStatus.DRAFT}>Bản nháp</option>
                  <option value={ContentStatus.IDEA}>Ý tưởng</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Bài mới bắt đầu ở trạng thái nháp hoặc ý tưởng, sau đó chuyển qua duyệt để hẹn giờ hoặc xuất bản.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="cn-6" className="block text-xs font-semibold text-gray-700 mb-1">
                Tóm tắt
              </label>
              <textarea id="cn-6"
                rows={2}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Tóm tắt ngắn cho danh sách và công cụ tìm kiếm…"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="cn-7" className="block text-xs font-semibold text-gray-700 mb-1">
                Nội dung (HTML hoặc Markdown) <span className="text-red-500">*</span>
              </label>
              <textarea id="cn-7"
                rows={12}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Viết nội dung bài viết tại đây…"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono text-xs"
              />
            </div>
          </div>
        </Card>

        <Card title="SEO & OpenGraph">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cn-8" className="block text-xs font-semibold text-gray-700 mb-1">
                  Tiêu đề SEO tùy chỉnh
                </label>
                <input id="cn-8"
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="Mặc định lấy tiêu đề bài viết"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cn-9" className="block text-xs font-semibold text-gray-700 mb-1">
                  URL chuẩn (canonical)
                </label>
                <input id="cn-9"
                  type="url"
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  placeholder="https://example.com/original-article"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cn-10" className="block text-xs font-semibold text-gray-700 mb-1">
                Mô tả meta
              </label>
              <textarea id="cn-10"
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder="Nên dài 120–160 ký tự cho đoạn trích tìm kiếm"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cn-11" className="block text-xs font-semibold text-gray-700 mb-1">
                  URL ảnh đại diện
                </label>
                <input id="cn-11"
                  type="url"
                  value={featuredImageUrl}
                  onChange={(e) => setFeaturedImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cn-12" className="block text-xs font-semibold text-gray-700 mb-1">
                  Văn bản thay thế của ảnh đại diện
                </label>
                <input id="cn-12"
                  type="text"
                  value={featuredImageAlt}
                  onChange={(e) => setFeaturedImageAlt(e.target.value)}
                  placeholder="Mô tả ảnh cho trình đọc màn hình và SEO"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cn-13" className="block text-xs font-semibold text-gray-700 mb-1">
                OpenGraph Image URL
              </label>
              <input id="cn-13"
                type="url"
                value={ogImageUrl}
                onChange={(e) => setOgImageUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href="/content">
            <Button type="button" variant="outline">
              Hủy
            </Button>
          </Link>
          <Button type="submit" variant="primary" disabled={saving || authLoading}>
            {saving ? "Đang lưu…" : "Tạo bài viết"}
          </Button>
        </div>
      </form>
    </main>
  );
}
