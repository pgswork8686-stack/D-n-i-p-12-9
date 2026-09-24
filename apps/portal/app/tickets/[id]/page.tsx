"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { StatusBadge } from "../../components/status-badge";
import { Skeleton } from "../../components/skeleton";
import { ErrorState } from "../../components/error-state";
import { Button, Card, Badge } from "@nexus/ui";
import { TicketDto, TicketPriority } from "@nexus/contracts";

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();

  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reply form state
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const fetchTicket = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const res = await client.getMyTicket(id);
      setTicket(res);
    } catch (err: any) {
      setError(err?.message || "Ticket not found or unauthorized");
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !ticket) return;
    setReplyError(null);

    const clean = replyBody.trim();
    if (!clean) {
      setReplyError("Please enter a response message");
      return;
    }

    setReplying(true);
    try {
      const client = getApiClient(token);
      await client.replyTicket(ticket.id, {
        body: clean,
      });

      setReplyBody("");
      await fetchTicket();
    } catch (err: any) {
      setReplyError(err?.message || "Failed to post reply");
    } finally {
      setReplying(false);
    }
  };

  const getPriorityBadgeVariant = (p?: TicketPriority): "error" | "warning" | "info" => {
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
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Back button */}
          <div>
            <Link
              href="/tickets"
              className="text-sm font-medium text-slate-500 hover:text-[#0037b0] transition flex items-center gap-1.5"
            >
              <span>←</span>
              <span>Back to Tickets</span>
            </Link>
          </div>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-3/4 rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : error || !ticket ? (
            <ErrorState
              title="Ticket Not Accessible"
              message={error || "Ticket does not exist or you do not have permission to view it."}
              onRetry={fetchTicket}
            />
          ) : (
            <div className="space-y-6">
              {/* Ticket Summary Header */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {ticket.ticketNumber}
                      </span>
                      <Badge variant={getPriorityBadgeVariant(ticket.priority)}>
                        {ticket.priority}
                      </Badge>
                      <span className="text-xs font-semibold text-slate-500">
                        {ticket.category}
                      </span>
                    </div>
                    <h1 className="text-xl font-bold text-slate-900">
                      {ticket.subject}
                    </h1>
                  </div>

                  <div className="flex items-center gap-2">
                    <StatusBadge status={ticket.status} />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-500">
                  <div>
                    <span className="block font-medium text-slate-400">Created</span>
                    <span className="font-semibold text-slate-700">
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="block font-medium text-slate-400">Last Activity</span>
                    <span className="font-semibold text-slate-700">
                      {new Date(ticket.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div>
                    <span className="block font-medium text-slate-400">Related Order</span>
                    <span className="font-mono font-semibold text-slate-700">
                      {ticket.orderId || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="block font-medium text-slate-400">Resolution</span>
                    <span className="font-semibold text-slate-700">
                      {ticket.closedAt ? "Closed" : "In Progress"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Conversation Messages */}
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                  Conversation History ({ticket.messages?.length || 0})
                </h2>

                <div className="space-y-3">
                  {(ticket.messages || []).map((msg) => {
                    const isStaff = msg.senderType === "STAFF";
                    const isSystem = msg.senderType === "SYSTEM";

                    return (
                      <div
                        key={msg.id}
                        className={`p-5 rounded-2xl border transition ${
                          isStaff
                            ? "bg-blue-50/60 border-blue-200 ml-4 sm:ml-8"
                            : isSystem
                            ? "bg-slate-100 border-slate-200 text-center italic text-xs py-3"
                            : "bg-white border-slate-200 mr-4 sm:mr-8"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                          <span className="font-semibold">
                            {isStaff ? "🛡️ Support Representative" : isSystem ? "⚙️ System" : "👤 You"}
                          </span>
                          <span>{new Date(msg.createdAt).toLocaleString()}</span>
                        </div>

                        <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {msg.body}
                        </div>

                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-wrap gap-2">
                            {msg.attachments.map((att) => (
                              <span
                                key={att.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600"
                              >
                                <span>📎</span>
                                <span>{att.fileName}</span>
                                <span className="text-slate-400">
                                  ({Math.round(att.sizeBytes / 1024)} KB)
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reply Box */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-slate-800">
                  {ticket.status === "CLOSED" ? "Reopen & Reply to Ticket" : "Post a Reply"}
                </h3>

                {replyError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                    {replyError}
                  </div>
                )}

                <form onSubmit={handleSendReply} className="space-y-3">
                  <textarea
                    rows={4}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder="Type your reply or additional information here..."
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={replying}
                  />

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                      Replying will notify support staff and update ticket status.
                    </p>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={replying || !replyBody.trim()}
                    >
                      {replying ? "Sending..." : "Send Reply"}
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
