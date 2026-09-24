"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card, Badge } from "@nexus/ui";
import { TicketDto, TicketPriority, TicketStatus } from "@nexus/contracts";

export default function TicketsPage() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Create Ticket Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [priority, setPriority] = useState<TicketPriority>("NORMAL");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const query = statusFilter !== "ALL" ? { status: statusFilter as TicketStatus } : undefined;
      const res = await client.listMyTickets(query);
      setTickets(res.items || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setFormError(null);

    const cleanSubject = subject.trim();
    const cleanBody = body.trim();

    if (!cleanSubject) {
      setFormError("Please enter a subject");
      return;
    }
    if (!cleanBody) {
      setFormError("Please describe your issue or question in detail");
      return;
    }

    setSubmitting(true);
    try {
      const client = getApiClient(token);
      const created = await client.createTicket({
        subject: cleanSubject,
        body: cleanBody,
        category,
        priority,
        orderId: orderId.trim() || undefined,
      });

      setShowCreateModal(false);
      setSubject("");
      setBody("");
      setOrderId("");
      setCategory("GENERAL");
      setPriority("NORMAL");
      setCreateSuccess(`Ticket #${created.ticketNumber} opened successfully!`);
      await fetchTickets();
    } catch (err: any) {
      setFormError(err?.message || "Failed to submit support ticket");
    } finally {
      setSubmitting(false);
    }
  };

  const getPriorityBadgeVariant = (p: TicketPriority): "error" | "warning" | "info" => {
    switch (p) {
      case "URGENT":
        return "error";
      case "HIGH":
        return "warning";
      case "LOW":
        return "info";
      default:
        return "info";
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Support Helpdesk & Tickets
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Open support inquiries, communicate with technical staff, and track resolution SLA.
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2"
            >
              <span>+</span>
              <span>Open New Ticket</span>
            </Button>
          </div>

          {/* Feedback Messages */}
          {createSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-center justify-between">
              <span>{createSuccess}</span>
              <button
                onClick={() => setCreateSuccess(null)}
                className="text-emerald-600 hover:text-emerald-900 font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Status Filters */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 overflow-x-auto">
            {["ALL", "OPEN", "WAITING_CUSTOMER", "WAITING_STAFF", "RESOLVED", "CLOSED"].map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    statusFilter === st
                      ? "bg-[#0037b0] text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {st.replace("_", " ")}
                </button>
              ),
            )}
          </div>

          {/* Content Area */}
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : error ? (
            <ErrorState title="Error Loading Tickets" message={error} onRetry={fetchTickets} />
          ) : tickets.length === 0 ? (
            <EmptyState
              icon="🎫"
              title="No Support Tickets Found"
              description={
                statusFilter === "ALL"
                  ? "You have not submitted any support tickets yet. Need help with a theme, hosting, or license?"
                  : `No tickets matching filter '${statusFilter}'.`
              }
              actionText="Create Your First Ticket"
              onAction={() => setShowCreateModal(true)}
            />
          ) : (
            <div className="grid gap-3">
              {tickets.map((t) => (
                <Link
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="block p-5 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:shadow-sm transition group"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {t.ticketNumber}
                        </span>
                        <Badge variant={getPriorityBadgeVariant(t.priority)}>
                          {t.priority}
                        </Badge>
                        <span className="text-xs font-medium text-slate-400">
                          {t.category}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 group-hover:text-[#0037b0] transition">
                        {t.subject}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Updated {new Date(t.updatedAt).toLocaleString()} •{" "}
                        {t.messages?.length || 0} messages
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <StatusBadge status={t.status} />
                      <span className="text-slate-400 group-hover:translate-x-1 transition">
                        →
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Create Ticket Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b pb-3">
                  <h2 className="text-lg font-bold text-slate-900">
                    Open Support Ticket
                  </h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-slate-400 hover:text-slate-700 font-bold"
                  >
                    ✕
                  </button>
                </div>

                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                    {formError}
                  </div>
                )}

                <form onSubmit={handleCreateTicket} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g. Cannot connect domain to cPanel hosting"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Category
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="GENERAL">General</option>
                        <option value="TECHNICAL">Technical Support</option>
                        <option value="HOSTING">Cloud Hosting</option>
                        <option value="BILLING">Billing & Invoices</option>
                        <option value="LICENSING">Licensing & Keys</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Priority
                      </label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as TicketPriority)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="LOW">Low (48h SLA)</option>
                        <option value="NORMAL">Normal (24h SLA)</option>
                        <option value="HIGH">High (6h SLA)</option>
                        <option value="URGENT">Urgent (2h SLA)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Order / Product Reference (Optional)
                    </label>
                    <input
                      type="text"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      placeholder="e.g. ORD-2026-..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Message Details
                    </label>
                    <textarea
                      rows={5}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Please describe the steps to reproduce or any error messages you received..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCreateModal(false)}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={submitting}
                    >
                      {submitting ? "Submitting..." : "Submit Ticket"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
