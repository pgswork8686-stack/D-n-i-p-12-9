"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button } from "@nexus/ui";
import { ServiceProjectStatus, ServiceProjectSummaryDto } from "@nexus/contracts";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { PROJECT_VARIANT, ServicesNav, fieldClass, formatDate } from "../components/services-nav";

const STATUSES: (ServiceProjectStatus | "")[] = ["", "PLANNING", "IN_PROGRESS", "ON_HOLD", "IN_REVIEW", "COMPLETED", "CANCELLED"];
const PAGE_SIZE = 20;

type Row = ServiceProjectSummaryDto & { customerEmail: string | null };

export default function AdminProjectsPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const res = await getApiClient(token).adminListServiceProjects({
        status: status || undefined,
        search: query || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, status, query, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      <ServicesNav
        title="Service Projects"
        subtitle="Customer projects, milestones and staff assignments"
        actions={
          <Button variant="outline" className="text-xs" onClick={load}>
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <label className="sr-only" htmlFor="prj-status">
          Status
        </label>
        <select
          id="prj-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={`${fieldClass} sm:w-48`}
        >
          {STATUSES.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
        >
          <label className="sr-only" htmlFor="prj-search">
            Search
          </label>
          <input id="prj-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, title, customer email…" className={fieldClass} />
          <Button type="submit" variant="outline" className="text-xs">
            Search
          </Button>
        </form>
      </div>

      {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{error}</div>}

      <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Milestones</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  No projects yet. Convert a qualified inquiry to create one.
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/service-projects/${p.id}`} className="font-semibold text-[#0037b0] hover:underline">
                      {p.title}
                    </Link>
                    <div className="font-mono text-[11px] text-gray-400">{p.projectCode}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 break-all">{p.customerEmail || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{p.service.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {p.milestoneProgress.done}/{p.milestoneProgress.total}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(p.targetDate)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={PROJECT_VARIANT[p.status]}>{p.status}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
        <span>{total} projects</span>
        <div className="flex gap-2">
          <Button variant="outline" className="text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="px-2 py-1">
            {page}/{totalPages}
          </span>
          <Button variant="outline" className="text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </main>
  );
}
