"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { InquiryNoticeSummary, safeInquiryPath, summarizeInquiryNotices } from "../lib/inquiry-notifications";

const formatDateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN");

/**
 * Unread "new service inquiry" notices for the signed-in staff member, shown on every Services
 * screen. The notices are written by the worker only for accounts with `inquiry.read`, so this
 * is a convenience view: the inquiries list stays the source of truth and still enforces access.
 */
export function InquiryNotifications() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<InquiryNoticeSummary>({ items: [], overflow: 0 });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const list = await getApiClient(token).listMyNotifications({ isRead: false, limit: 50 });
      setSummary(summarizeInquiryNotices(list));
    } catch {
      // The banner is optional: a failure here must not break the page it decorates.
      setSummary({ items: [], overflow: 0 });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (id: string) => {
    if (!token) return;
    try {
      await getApiClient(token).markNotificationAsRead(id);
    } finally {
      setSummary((s) => ({ ...s, items: s.items.filter((n) => n.id !== id) }));
    }
  };

  if (summary.items.length === 0) return null;

  return (
    <section aria-label="Yêu cầu dịch vụ mới" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-amber-900">
          {summary.items.length + summary.overflow} yêu cầu dịch vụ mới chưa xem
        </h2>
        <button type="button" onClick={load} className="text-xs font-medium text-amber-900 underline">
          Làm mới
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {summary.items.map((n) => {
          const href = safeInquiryPath(n.actionUrl);
          return (
            <li key={n.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                {href ? (
                  <Link href={href} onClick={() => markRead(n.id)} className="font-semibold text-[#0037b0] hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  <span className="font-semibold text-gray-900">{n.title}</span>
                )}
                <div className="truncate text-xs text-gray-600">
                  {n.message} · {formatDateTime(n.createdAt)}
                </div>
              </div>
              <button type="button" onClick={() => markRead(n.id)} className="shrink-0 text-xs text-gray-600 underline">
                Đã xem
              </button>
            </li>
          );
        })}
      </ul>
      {summary.overflow > 0 && (
        <p className="mt-2 text-xs text-amber-900">
          và {summary.overflow} yêu cầu khác. Xem trong <Link href="/service-inquiries" className="underline">danh sách yêu cầu</Link>.
        </p>
      )}
    </section>
  );
}
