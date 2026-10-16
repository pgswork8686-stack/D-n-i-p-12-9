"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryDto } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiUrl } from "../../lib/api";
import { flattenAdminCategories, validateAdminCategory } from "../../lib/admin-categories";

export default function AdminCategoriesPage() {
  const { user, token, isLoading: authLoading } = useAuth();
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const canRead = Boolean(user?.permissions?.includes("product.read") || user?.roles?.includes("super_admin"));
  const canWrite = Boolean(user?.permissions?.includes("product.write") || user?.roles?.includes("super_admin"));

  const refresh = useCallback(async () => {
    if (!token || !canRead) {
      setLoading(false);
      setError("Bạn cần quyền product.read để xem danh mục.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl() + "/admin/categories", {
        headers: { Authorization: "Bearer " + token }, cache: "no-store",
      });
      if (!res.ok) throw new Error(res.status === 403 ? "Không có quyền xem danh mục." : "Không tải được danh mục.");
      setCategories(await res.json() as CategoryDto[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải danh mục.");
    } finally { setLoading(false); }
  }, [token, canRead]);

  useEffect(() => { if (!authLoading) void refresh(); }, [authLoading, refresh]);
  const rows = useMemo(() => flattenAdminCategories(categories), [categories]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !canWrite || saving) return;
    const invalid = validateAdminCategory(name, slug);
    if (invalid) { setError(invalid); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch(getApiUrl() + "/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ name: name.trim(), slug, ...(parentId ? { parentId } : {}) }),
      });
      if (!res.ok) throw new Error(res.status === 409 ? "Slug này đã có." :
        res.status === 403 ? "Không có quyền tạo danh mục." : "Không tạo được danh mục.");
      setName(""); setSlug(""); setParentId("");
      setNotice("Đã tạo danh mục."); await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tạo danh mục.");
    } finally { setSaving(false); }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-10">
      <Link href="/admin/products" className="text-sm font-semibold text-blue-700 hover:underline">← Sản phẩm</Link>
      <h1 className="text-3xl font-bold">Quản lý danh mục</h1>
      <p className="text-slate-600">Danh mục được lấy trực tiếp từ Admin API theo phân quyền máy chủ.</p>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{notice}</p>}
      {canWrite && (
        <section aria-label="Thêm danh mục" className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-bold">Thêm danh mục</h2>
          <form onSubmit={create} className="mt-4 grid gap-4 md:grid-cols-3">
            <div><label htmlFor="new-category-name" className="block text-sm font-semibold">Tên</label>
              <input id="new-category-name" required className="mt-2 w-full rounded-lg border p-3" value={name} disabled={saving} onChange={e => setName(e.target.value)} /></div>
            <div><label htmlFor="new-category-slug" className="block text-sm font-semibold">Slug</label>
              <input id="new-category-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" className="mt-2 w-full rounded-lg border p-3" value={slug} disabled={saving} onChange={e => setSlug(e.target.value)} /></div>
            <div><label htmlFor="new-category-parent" className="block text-sm font-semibold">Danh mục cha</label>
              <select id="new-category-parent" className="mt-2 w-full rounded-lg border p-3" value={parentId} disabled={saving} onChange={e => setParentId(e.target.value)}>
                <option value="">Không có</option>
                {rows.filter(row => row.category.status === "ACTIVE").map(({ category, depth }) =>
                  <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}
              </select></div>
            <div className="md:col-span-3"><button className="rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white disabled:opacity-50" disabled={saving} type="submit">
              {saving ? "Đang tạo…" : "Tạo danh mục"}</button></div>
          </form>
        </section>
      )}
      <section aria-label="Các danh mục" className="overflow-x-auto rounded-2xl border bg-white p-5">
        {loading ? <p role="status">Đang tải danh mục…</p> :
          !error && rows.length === 0 ? <p>Chưa có danh mục.</p> :
          rows.length > 0 ? (
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead><tr className="border-b"><th className="p-3">Tên</th><th className="p-3">Slug</th><th className="p-3">Trạng thái</th><th className="p-3">Thứ tự</th></tr></thead>
              <tbody>{rows.map(({ category, depth }) =>
                <tr key={category.id} className="border-b">
                  <td className="p-3 font-semibold" style={{ paddingLeft: 12 + depth * 18 }}>{depth ? "↳ " : ""}{category.name}</td>
                  <td className="p-3 font-mono">{category.slug}</td><td className="p-3">{category.status}</td><td className="p-3">{category.sortOrder}</td>
                </tr>)}</tbody>
            </table>
          ) : null}
      </section>
    </main>
  );
}
