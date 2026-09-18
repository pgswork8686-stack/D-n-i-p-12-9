"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

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
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>(
    isDevAuthToolsEnabled ? "dev-admin-token" : "",
  );
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  const fetchPosts = () => {
    if (!authToken) {
      setError("Access Denied (401 Unauthorized): Please provide an authenticated admin token.");
      setLoading(false);
      setPosts([]);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.append("status", statusFilter);
    if (search) params.append("search", search);
    params.append("page", page.toString());
    params.append("limit", "15");

    fetch(`${API_URL}/admin/content/posts?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setPosts(data.items || []);
        setTotalPages(data.totalPages || 1);
        setTotalItems(data.total || 0);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
        setPosts([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPosts();
  }, [authToken, statusFilter, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchPosts();
  };

  return (
    <main className="max-w-7xl mx-auto py-10 px-6 font-sans">
      {isDevAuthToolsEnabled && (
        <div className="mb-6 bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Simulate Token (Dev Only):</span>
          <div className="flex gap-2">
            <button
              onClick={() => setAuthToken("dev-admin-token")}
              className={`px-2.5 py-1 rounded border font-medium ${
                authToken === "dev-admin-token" ? "bg-[#0037b0] text-white" : "bg-white text-gray-700"
              }`}
            >
              Admin Token (Pass)
            </button>
            <button
              onClick={() => setAuthToken("dev-customer-token")}
              className={`px-2.5 py-1 rounded border font-medium ${
                authToken === "dev-customer-token" ? "bg-amber-600 text-white" : "bg-white text-gray-700"
              }`}
            >
              Customer Token (403)
            </button>
            <button
              onClick={() => setAuthToken("")}
              className={`px-2.5 py-1 rounded border font-medium ${
                !authToken ? "bg-red-600 text-white" : "bg-white text-gray-700"
              }`}
            >
              No Token (401)
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">CMS & Publishing System</h1>
            <Badge variant="info">{totalItems} Posts</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Authoritative lifecycle transitions, SEO metadata, and scheduled release management.
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
            placeholder="Search by title or slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0037b0] w-full md:w-72"
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <label className="text-xs font-semibold text-gray-600">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
          >
            <option value="">All Statuses</option>
            <option value="IDEA">IDEA</option>
            <option value="DRAFT">DRAFT</option>
            <option value="AI_DRAFT">AI_DRAFT</option>
            <option value="REVIEW">REVIEW</option>
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="PUBLISHED">PUBLISHED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="p-8 bg-red-50 border border-red-200 rounded-xl text-center space-y-2 mb-6">
          <div className="text-2xl">⚠️</div>
          <h3 className="text-sm font-bold text-red-800">Error Loading Content Posts</h3>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      ) : loading ? (
        <div className="p-12 text-center text-gray-500 text-sm">Loading articles...</div>
      ) : posts.length === 0 ? (
        <Card>
          <div className="p-12 text-center space-y-3">
            <div className="text-3xl">📝</div>
            <h3 className="text-base font-semibold text-gray-800">No Content Posts Found</h3>
            <p className="text-xs text-gray-500">
              {statusFilter
                ? `There are no posts with status '${statusFilter}'.`
                : "Create your first article or page to get started."}
            </p>
            <Link href="/content/new">
              <Button variant="primary" size="sm">
                Create First Article
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Title / Slug</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Date Info</th>
                  <th className="px-4 py-3 text-right">Actions</th>
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
                        {post.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{post.contentType}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {post.category ? post.category.name : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {post.author?.displayName || post.author?.email || <span className="text-gray-400">System</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {post.status === "PUBLISHED" && post.publishedAt && (
                        <div>Pub: {new Date(post.publishedAt).toLocaleDateString()}</div>
                      )}
                      {post.status === "SCHEDULED" && post.scheduledAt && (
                        <div className="text-amber-600 font-medium">
                          Sched: {new Date(post.scheduledAt).toLocaleString()}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-400">
                        {post.readingTimeMinutes ? `${post.readingTimeMinutes} min read` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/content/${post.id}`}>
                        <Button variant="outline" size="sm">
                          Edit / Manage
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
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
