"use client";

import { postStatusLabel } from "../lib/catalog-labels";
import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import { AdminContentPostDto, ContentStatus } from "@nexus/contracts";
import { useAuth, isDevAuthToolsEnabled } from "../context/auth-context";
import { getApiClient } from "../lib/api";

const STATUS_COLORS: Record<string, "info" | "success" | "warning" | "error"> = {
  IDEA: "info",
  DRAFT: "info",
  AI_DRAFT: "warning",
  REVIEW: "warning",
  SCHEDULED: "warning",
  PUBLISHED: "success",
  ARCHIVED: "error",
};

export default function AdminContentPage() {
  const { token, user, isLoading: authLoading, loginWithDevToken } = useAuth();
  const [posts, setPosts] = useState<AdminContentPostDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  const fetchPosts = useCallback(async () => {
    if (!token) {
      if (!authLoading) {
        setError("Không có quyền truy cập (401). Vui lòng đăng nhập bằng tài khoản quản trị.");
        setLoading(false);
        setPosts([]);
      }
      return;
    }

    setLoading(true);
    try {
      const client = getApiClient(token);
      const res = await client.listAdminContentPosts({
        status: statusFilter ? (statusFilter as ContentStatus) : undefined,
        search: search.trim() || undefined,
        page,
        limit: 15,
      });

      setPosts(res.items || []);
      setTotalPages(res.totalPages || 1);
      setTotalItems(res.total || 0);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Không tải được danh sách bài viết.");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, statusFilter, search, page]);

  useEffect(() => {
    if (!authLoading) {
      fetchPosts();
    }
  }, [authLoading, fetchPosts]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchPosts();
  };

  const showDevTools = isDevAuthToolsEnabled();

  return (
    <main className="max-w-7xl mx-auto py-10 px-6 font-sans">
      {showDevTools && (
        <div className="mb-6 bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Giả lập token (chỉ môi trường thử nghiệm):</span>
          <div className="flex gap-2">
            <button
              onClick={() => loginWithDevToken("dev-admin-token")}
              className={`px-2.5 py-1 rounded border font-medium ${
                token === "dev-admin-token" ? "bg-[#0037b0] text-white" : "bg-white text-gray-700"
              }`}
            >
              Token quản trị (hợp lệ)
            </button>
            <button
              onClick={() => loginWithDevToken("dev-customer-token")}
              className={`px-2.5 py-1 rounded border font-medium ${
                token === "dev-customer-token" ? "bg-amber-600 text-white" : "bg-white text-gray-700"
              }`}
            >
              Token khách hàng (403)
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Nội dung & xuất bản</h1>
            <Badge variant="info">{totalItems} Posts</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Quản lý vòng đời bài viết, SEO và lịch xuất bản.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/content/categories">
            <Button variant="secondary" size="sm">
              🏷️ Categories
            </Button>
          </Link>
          <Link href="/content/new">
            <Button variant="primary" size="sm">
              + New Article
            </Button>
          </Link>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-200 mb-6 flex flex-col md:flex-row gap-4 justify-between items-center">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full md:w-auto">
          <input
            type="text"
            placeholder="Tìm theo tiêu đề hoặc slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0037b0] w-full md:w-72"
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <label className="text-xs font-semibold text-gray-600">Trạng thái:</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="IDEA">Ý tưởng</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="AI_DRAFT">Nháp AI</option>
            <option value="REVIEW">Chờ duyệt</option>
            <option value="SCHEDULED">Đã lên lịch</option>
            <option value="PUBLISHED">Đã xuất bản</option>
            <option value="ARCHIVED">Đã lưu trữ</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="p-8 bg-red-50 border border-red-200 rounded-xl text-center space-y-3 mb-6">
          <div className="text-2xl">⚠️</div>
          <h3 className="text-sm font-bold text-red-800">Không tải được bài viết</h3>
          <p className="text-xs text-red-600">{error}</p>
          {!token && (
            <div className="pt-2">
              <Link href="/login">
                <Button variant="primary" size="sm">
                  Đăng nhập quản trị
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : loading || authLoading ? (
        <div className="p-12 text-center text-gray-500 text-sm">Đang tải bài viết…</div>
      ) : posts.length === 0 ? (
        <Card>
          <div className="p-12 text-center space-y-3">
            <div className="text-3xl">📝</div>
            <h3 className="text-base font-semibold text-gray-800">Chưa có bài viết</h3>
            <p className="text-xs text-gray-500">
              {statusFilter
                ? `Không có bài viết ở trạng thái “${postStatusLabel(statusFilter)}”.`
                : "Hãy tạo bài viết hoặc trang đầu tiên."}
            </p>
            <Link href="/content/new">
              <Button variant="primary" size="sm">
                Tạo bài viết đầu tiên
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Tiêu đề / slug</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Loại</th>
                  <th className="px-4 py-3">Danh mục</th>
                  <th className="px-4 py-3">Tác giả</th>
                  <th className="px-4 py-3">Ngày</th>
                  <th className="px-4 py-3 text-right"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {posts.map((post) => (
                  <tr key={post.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{post.title}</div>
                      <div className="text-xs text-gray-400 font-mono">/{post.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_COLORS[post.status] || "info"}>
                        {postStatusLabel(post.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{post.contentType}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {post.category ? post.category.name : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {post.author?.displayName || post.author?.email || <span className="text-gray-400">Hệ thống</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {post.status === "PUBLISHED" && post.publishedAt && (
                        <div>Xuất bản: {new Date(post.publishedAt).toLocaleDateString("vi-VN")}</div>
                      )}
                      {post.status === "SCHEDULED" && post.scheduledAt && (
                        <div className="text-amber-600 font-medium">
                          Hẹn giờ: {new Date(post.scheduledAt).toLocaleString("vi-VN")}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-400">
                        {post.readingTimeMinutes ? `${post.readingTimeMinutes} phút đọc` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/content/${post.id}`}>
                        <Button variant="outline" size="sm">
                          Sửa / quản lý
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
              <div>
                Trang {page} / {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
