"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card, Badge } from "@nexus/ui";
import { NotificationDto } from "@nexus/contracts";

export default function NotificationsPage() {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter: 'ALL' or 'UNREAD'
  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const [list, countRes] = await Promise.all([
        client.listMyNotifications(filter === "UNREAD" ? { isRead: false } : undefined),
        client.getUnreadNotificationCount(),
      ]);
      setNotifications(list);
      setUnreadCount(countRes.count);
    } catch (err: any) {
      setError(err?.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    if (!token) return;
    try {
      const client = getApiClient(token);
      await client.markNotificationAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark notification read", err);
    }
  };

  const handleMarkAllRead = async () => {
    if (!token) return;
    setActionLoading(true);
    try {
      const client = getApiClient(token);
      await client.markAllNotificationsAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all read", err);
    } finally {
      setActionLoading(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "TICKET_REPLIED":
      case "TICKET_CREATED":
      case "TICKET_UPDATE":
        return "🎫";
      case "ORDER_CONFIRMED":
        return "📦";
      case "LICENSE_EXPIRING":
        return "🔑";
      case "SECURITY_ALERT":
        return "⚠️";
      default:
        return "🔔";
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  Notification Center
                </h1>
                {unreadCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Stay informed with ticket updates, license reminders, and account alerts.
              </p>
            </div>

            {unreadCount > 0 && (
              <Button
                variant="outline"
                onClick={handleMarkAllRead}
                disabled={actionLoading}
                className="text-xs"
              >
                {actionLoading ? "Updating..." : "Mark All as Read"}
              </Button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <button
              onClick={() => setFilter("ALL")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === "ALL"
                  ? "bg-[#0037b0] text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              All Notifications
            </button>
            <button
              onClick={() => setFilter("UNREAD")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === "UNREAD"
                  ? "bg-[#0037b0] text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Unread Only ({unreadCount})
            </button>
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : error ? (
            <ErrorState
              title="Error Loading Notifications"
              message={error}
              onRetry={fetchNotifications}
            />
          ) : notifications.length === 0 ? (
            <EmptyState
              icon="🔔"
              title="No Notifications"
              description={
                filter === "UNREAD"
                  ? "You have caught up with all your notifications!"
                  : "You have no notifications in your history."
              }
            />
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 rounded-xl border transition flex items-start justify-between gap-4 ${
                    n.isRead
                      ? "bg-white border-slate-200 text-slate-700"
                      : "bg-blue-50/50 border-blue-200 text-slate-900 shadow-xs"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0 mt-0.5">
                      {getTypeIcon(n.type)}
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{n.title}</h3>
                        {!n.isRead && (
                          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {n.message}
                      </p>
                      <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-400">
                        <span>{new Date(n.createdAt).toLocaleString()}</span>
                        {n.actionUrl && (
                          <Link
                            href={n.actionUrl}
                            className="font-medium text-[#0037b0] hover:underline"
                          >
                            View Details →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {!n.isRead && (
                    <button
                      onClick={() => handleMarkAsRead(n.id)}
                      className="text-xs text-slate-400 hover:text-slate-700 font-medium whitespace-nowrap p-1 rounded hover:bg-slate-100 transition"
                      title="Mark as read"
                    >
                      ✓ Mark read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
