"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import {
  AutomationJobDto,
  AutomationJobStatus,
  AutomationJobType,
} from "@nexus/contracts";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";

const STATUS_COLORS: Record<string, "info" | "success" | "warning" | "error"> = {
  PENDING: "info",
  RUNNING: "warning",
  SUCCEEDED: "success",
  FAILED: "error",
  CANCELLED: "info",
};

export default function AutomationJobsPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<AutomationJobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // AI Draft Modal State
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiBrief, setAiBrief] = useState("");
  const [aiLanguage, setAiLanguage] = useState("vi");
  const [aiSubmitting, setAiSubmitting] = useState(false);
  const [aiSuccessMsg, setAiSuccessMsg] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!token) {
      if (!authLoading) {
        setError("Access Denied (401 Unauthorized): Please sign in with an authenticated admin account.");
        setLoading(false);
        setJobs([]);
      }
      return;
    }

    setLoading(true);
    try {
      const client = getApiClient(token);
      const res = await client.listAutomationJobs({
        status: statusFilter ? (statusFilter as AutomationJobStatus) : undefined,
        type: typeFilter ? (typeFilter as AutomationJobType) : undefined,
        page,
        limit: 15,
      });

      setJobs(res.items || []);
      setTotalPages(res.totalPages || 1);
      setTotalItems(res.total || 0);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load automation jobs.");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, statusFilter, typeFilter, page]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleRetry = async (id: string) => {
    if (!token) return;
    try {
      const client = getApiClient(token);
      await client.retryAutomationJob(id);
      fetchJobs();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    }
  };

  const handleCreateAiDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !aiTopic.trim() || !aiBrief.trim()) return;

    setAiSubmitting(true);
    try {
      const client = getApiClient(token);
      const job = await client.createAiDraftRequest({
        topic: aiTopic.trim(),
        brief: aiBrief.trim(),
        language: aiLanguage,
      });
      setAiSuccessMsg(`AI draft job queued: ${job.id}. The worker and n8n will process it.`);
      setAiTopic("");
      setAiBrief("");
      setTimeout(() => {
        setShowAiModal(false);
        setAiSuccessMsg(null);
        fetchJobs();
      }, 2000);
    } catch (err: any) {
      alert(`Failed to queue AI draft: ${err.message}`);
    } finally {
      setAiSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Automation & AI Engine</h1>
          <p className="text-sm text-slate-500">
            Outbox jobs, AI draft orchestration, and transactional notifications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowAiModal(true)}
          >
            ✨ Generate AI Draft
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4 bg-white border border-slate-200">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
            >
              <option value="">All Statuses</option>
              <option value="PENDING">PENDING</option>
              <option value="RUNNING">RUNNING</option>
              <option value="SUCCEEDED">SUCCEEDED</option>
              <option value="FAILED">FAILED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
            >
              <option value="">All Types</option>
              <option value="CMS_AI_DRAFT">CMS AI Draft</option>
              <option value="ORDER_PAID_EMAIL">Order Paid Email</option>
              <option value="LICENSE_PROVISIONED_EMAIL">License Provisioned Email</option>
            </select>
          </div>

          <span className="text-xs text-slate-400 ml-auto">
            {totalItems} total jobs
          </span>
        </div>
      </Card>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Job ID / Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Attempts</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Timestamps</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Loading automation jobs...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No automation jobs found.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3 px-4">
                      <Link
                        href={`/automation/${job.id}`}
                        className="font-medium text-slate-900 hover:text-[#0037b0] block"
                      >
                        {job.type}
                      </Link>
                      <span className="text-xs text-slate-400 font-mono">
                        {job.id.substring(0, 8)}...
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={STATUS_COLORS[job.status] || "info"}>
                        {job.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {job.sourceType ? `${job.sourceType}: ${job.sourceId?.substring(0, 8)}...` : "—"}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 space-y-0.5">
                      <div>Created: {new Date(job.createdAt).toLocaleString()}</div>
                      {job.completedAt && (
                        <div>Done: {new Date(job.completedAt).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Link
                        href={`/automation/${job.id}`}
                        className="text-xs text-[#0037b0] hover:underline font-medium"
                      >
                        View
                      </Link>
                      {job.status === "FAILED" && (
                        <button
                          onClick={() => handleRetry(job.id)}
                          className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {page} of {totalPages}
            </span>
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
      </Card>

      {/* AI Draft Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">✨ Request CMS AI Draft</h2>
              <button
                onClick={() => setShowAiModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {aiSuccessMsg ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm">
                {aiSuccessMsg}
              </div>
            ) : (
              <form onSubmit={handleCreateAiDraft} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Topic / Title Idea *
                  </label>
                  <input
                    type="text"
                    required
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="e.g. Modern Headless Architecture in 2026"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Editorial Brief / Key Points *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={aiBrief}
                    onChange={(e) => setAiBrief(e.target.value)}
                    placeholder="Provide outline, target audience, tone, or key product highlights..."
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Language
                  </label>
                  <select
                    value={aiLanguage}
                    onChange={(e) => setAiLanguage(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                  >
                    <option value="vi">Tiếng Việt (vi)</option>
                    <option value="en">English (en)</option>
                  </select>
                </div>

                <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800">
                  ⚠️ AI output will be saved strictly in <strong>AI_DRAFT</strong> status. Human editor review and approval are mandatory before publication.
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setShowAiModal(false)}
                    disabled={aiSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={aiSubmitting}
                  >
                    {aiSubmitting ? "Queueing..." : "Submit AI Request"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
