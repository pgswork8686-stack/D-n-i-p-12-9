"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button } from "@nexus/ui";
import { AdminServiceInquiryDto, ServiceInquiryStatus } from "@nexus/contracts";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { INQUIRY_VARIANT, ServicesNav, fieldClass, formatDateTime } from "../components/services-nav";

const STATUSES: (ServiceInquiryStatus | "")[] = ["", "NEW", "REVIEWING", "QUALIFIED", "REJECTED", "SPAM", "CONVERTED"];
const PAGE_SIZE = 20;

export default function AdminInquiriesPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<AdminServiceInquiryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("NEW");
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
      const res = await getApiClient(token).adminListServiceInquiries({
        status: status || undefined,
        search: query || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load inquiries");
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
        title="Service Inquiries"
        subtitle="Review project requests and convert qualified ones into projects"
        actions={
          <Button variant="outline" className="text-xs" onClick={load}>
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <label className="sr-only" htmlFor="inq-status">
          Status
        </label>
        <select
          id="inq-status"
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
          <label className="sr-only" htmlFor="inq-search">
            Search
          </label>
          <input
            id="inq-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, company, email…"
            className={fieldClass}
          />
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
              <th className="px-4 py-3">Inquiry</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Company / contact</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  No inquiries match these filters.
                </td>
              </tr>
            ) : (
              items.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/service-inquiries/${i.id}`} className="font-mono text-xs font-bold text-[#0037b0] hover:underline">
                      {i.inquiryNumber}
                    </Link>
                    {!i.userId && <div className="text-[11px] text-gray-400">anonymous</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{i.service.name}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{i.companyName}</div>
                    <div className="text-xs text-gray-500">
                      {i.contactName} • {i.contactEmail}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDateTime(i.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={INQUIRY_VARIANT[i.status]}>{i.status}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
        <span>{total} inquiries</span>
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
