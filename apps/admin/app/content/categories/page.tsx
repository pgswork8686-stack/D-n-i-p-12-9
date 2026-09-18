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
        setError("Unauthorized (401): Admin token required.");
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
      setError(err.message || "Failed to load categories.");
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
      setSuccessMsg("Category created successfully!");
      fetchCategories();
    } catch (err: any) {
      setError(err.message || "Failed to create category.");
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
      setSuccessMsg("Category updated successfully!");
      fetchCategories();
    } catch (err: any) {
      setError(err.message || "Failed to update category.");
    }
  };

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
        <div>
          <Link href="/content" className="text-xs text-[#0037b0] hover:underline font-semibold">
            ← Back to Content List
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-gray-900">Content Categories</h1>
            <Badge variant="info">{categories.length} Categories</Badge>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Taxonomy and topic clusters for articles and documentation.
          </p>
        </div>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Category Form */}
        <div className="lg:col-span-1">
          <Card title="Add New Category">
            <form onSubmit={handleCreateCategory} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tutorials"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Slug (optional)
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. tutorials"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief category description..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  SEO Title
                </label>
                <input
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="SEO Title override"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  SEO Description
                </label>
                <textarea
                  rows={2}
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  placeholder="Meta description for category archive..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>

              <Button type="submit" variant="primary" disabled={creating || authLoading} className="w-full">
                {creating ? "Creating..." : "+ Create Category"}
              </Button>
            </form>
          </Card>
        </div>

        {/* Categories List */}
        <div className="lg:col-span-2">
          <Card title="Existing Categories">
            {loading || authLoading ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading categories...</div>
            ) : categories.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No categories found. Create one on the left.</div>
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
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Edit Category Modal */}
      {editingCat && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Edit Category</h3>
            <form onSubmit={handleUpdateCategory} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={editingCat.name}
                  onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  required
                  value={editingCat.slug}
                  onChange={(e) => setEditingCat({ ...editingCat, slug: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editingCat.description || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">SEO Title</label>
                <input
                  type="text"
                  value={editingCat.seoTitle || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, seoTitle: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">SEO Description</label>
                <textarea
                  rows={2}
                  value={editingCat.seoDescription || ""}
                  onChange={(e) => setEditingCat({ ...editingCat, seoDescription: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingCat(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Save Category
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
