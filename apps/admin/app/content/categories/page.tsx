"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import { ContentCategoryDto } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";

export default function AdminContentCategoriesPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [categories, setCategories] = useState<ContentCategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Category Form
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit category modal state
  const [editingCat, setEditingCat] = useState<ContentCategoryDto | null>(null);

  const fetchCategories = useCallback(async () => {
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
      const data = await client.listAdminContentCategories();
      setCategories(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Không tải được danh mục.");
    } finally {
      setLoading(false);
    }
  }, [token, authLoading]);

  useEffect(() => {
    if (!authLoading) {
      fetchCategories();
    }
  }, [authLoading, fetchCategories]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !token) return;

    setCreating(true);
    setError(null);
    setSuccessMsg(null);

    const payload: any = { name: name.trim() };
    if (slug.trim()) payload.slug = slug.trim();
    if (description.trim()) payload.description = description.trim();
    if (seoTitle.trim()) payload.seoTitle = seoTitle.trim();
    if (seoDescription.trim()) payload.seoDescription = seoDescription.trim();

    try {
      const client = getApiClient(token);
      await client.createContentCategory(payload);

      setName("");
      setSlug("");
      setDescription("");
      setSeoTitle("");
      setSeoDescription("");
      setSuccessMsg("Đã tạo danh mục.");
      fetchCategories();
    } catch (err: any) {
      setError(err.message || "Không tạo được danh mục.");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat || !token) return;

    setError(null);
    setSuccessMsg(null);

    try {
      const client = getApiClient(token);
      await client.updateContentCategory(editingCat.id, {
        name: editingCat.name,
        slug: editingCat.slug,
        description: editingCat.description || undefined,
        seoTitle: editingCat.seoTitle || undefined,
        seoDescription: editingCat.seoDescription || undefined,
      });

      setEditingCat(null);
      setSuccessMsg("Đã cập nhật danh mục.");
      fetchCategories();
    } catch (err: any) {
      setError(err.message || "Không cập nhật được danh mục.");
    }
  };

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
        <div>
          <Link href="/content" className="text-xs text-[#0037b0] hover:underline font-semibold">
            ← Danh sách nội dung
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-gray-900">Danh mục nội dung</h1>
            <Badge variant="info">{categories.length} danh mục</Badge>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Phân loại và nhóm chủ đề cho bài viết và tài liệu.
          </p>
        </div>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Category Form */}
        <div className="lg:col-span-1">
          <Card title="Thêm danh mục">
            <form onSubmit={handleCreateCategory} className="space-y-4">
              <div>
                <label htmlFor="cc-1" className="block text-xs font-semibold text-gray-700 mb-1">
                  Tên <span className="text-red-500">*</span>
                </label>
                <input id="cc-1"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tutorials"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cc-2" className="block text-xs font-semibold text-gray-700 mb-1">
                  Đường dẫn (slug, không bắt buộc)
                </label>
                <input id="cc-2"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. tutorials"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label htmlFor="cc-3" className="block text-xs font-semibold text-gray-700 mb-1">
                  Description
                </label>
                <textarea id="cc-3"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả ngắn về danh mục…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cc-4" className="block text-xs font-semibold text-gray-700 mb-1">
                  SEO Title
                </label>
                <input id="cc-4"
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="Tiêu đề SEO (tùy chọn)"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cc-5" className="block text-xs font-semibold text-gray-700 mb-1">
                  SEO Description
                </label>
                <textarea id="cc-5"
                  rows={2}
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  placeholder="Mô tả meta cho trang danh mục…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <Button type="submit" variant="primary" disabled={creating || authLoading} className="w-full">
                {creating ? "Đang tạo…" : "+ Tạo danh mục"}
              </Button>
            </form>
          </Card>
        </div>

        {/* Categories List */}
        <div className="lg:col-span-2">
          <Card title="Danh mục hiện có">
            {loading || authLoading ? (
              <div className="p-8 text-center text-sm text-gray-500">Đang tải danh mục…</div>
            ) : categories.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Chưa có danh mục. Hãy tạo ở khung bên trái.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {categories.map((cat) => (
                  <div key={cat.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{cat.name}</span>
                        <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {cat.slug}
                        </code>
                        <span className="text-xs text-gray-400">({cat.postCount || 0} published)</span>
                      </div>
                      {cat.description && (
                        <p className="text-xs text-gray-500 mt-1">{cat.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingCat({ ...cat })}
                      className="text-xs font-semibold text-[#0037b0] hover:underline px-2 py-1"
                    >
                      Sửa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Sửa danh mục Modal */}
      {editingCat && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Sửa danh mục</h3>
            <form onSubmit={handleUpdateCategory} className="space-y-3">
              <div>
                <label htmlFor="cc-6" className="block text-xs font-semibold text-gray-700 mb-1">Tên</label>
                <input id="cc-6"
                  type="text"
                  required
                  value={editingCat.name}
                  onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cc-7" className="block text-xs font-semibold text-gray-700 mb-1">Đường dẫn (slug)</label>
                <input id="cc-7"
                  type="text"
                  required
                  value={editingCat.slug}
                  onChange={(e) => setEditingCat({ ...editingCat, slug: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>
              <div>
                <label htmlFor="cc-8" className="block text-xs font-semibold text-gray-700 mb-1">Mô tả</label>
                <textarea id="cc-8"
                  rows={2}
                  value={editingCat.description || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cc-9" className="block text-xs font-semibold text-gray-700 mb-1">Tiêu đề SEO</label>
                <input id="cc-9"
                  type="text"
                  value={editingCat.seoTitle || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, seoTitle: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cc-10" className="block text-xs font-semibold text-gray-700 mb-1">Mô tả SEO</label>
                <textarea id="cc-10"
                  rows={2}
                  value={editingCat.seoDescription || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, seoDescription: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingCat(null)}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Lưu danh mục
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
