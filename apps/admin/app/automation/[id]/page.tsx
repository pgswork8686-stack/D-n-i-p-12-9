"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Card } from "@nexus/ui";
import { AutomationJobDto } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";

const STATUS_COLORS: Record<string, "info" | "success" | "warning" | "error"> = {
  PENDING: "info",
  RUNNING: "warning",
  SUCCEEDED: "success",
  FAILED: "error",
  CANCELLED: "info",
};

export default function AutomationJobDetailPage() {
  const { id } = useParams() as { id: string };
  const { token, isLoading: authLoading } = useAuth();
  const [job, setJob] = useState<AutomationJobDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchJob = useCallback(async () => {
    if (!token) {
      if (!authLoading) {
        setError("Access Denied (401 Unauthorized): Please sign in.");
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const client = getApiClient(token);
      const res = await client.getAutomationJob(id);
      setJob(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load job details.");
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [id, token, authLoading]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  const handleRetry = async () => {
    if (!token || !job) return;
    setActionLoading(true);
    try {
      const client = getApiClient(token);
      await client.retryAutomationJob(job.id);
      fetchJob();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!token || !job) return;
    setActionLoading(true);
    try {
      const client = getApiClient(token);
      await client.cancelAutomationJob(job.id);
      fetchJob();
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-slate-400">
        Loading automation job details...
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Link href="/automation" className="text-sm text-[#0037b0] hover:underline">
          ← Back to Automation Jobs
        </Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error || "Job not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Top Breadcrumb & Header */}
      <div className="space-y-2">
        <Link href="/automation" className="text-sm text-[#0037b0] hover:underline">
          ← Back to Automation Jobs
        </Link>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{job.type}</h1>
            <Badge variant={STATUS_COLORS[job.status] || "info"}>
              {job.status}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            {job.status === "FAILED" && (
              <Button
                variant="primary"
                size="sm"
                disabled={actionLoading}
                onClick={handleRetry}
              >
                {actionLoading ? "Processing..." : "🔄 Retry Job"}
              </Button>
            )}
            {job.status === "PENDING" && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                onClick={handleCancel}
              >
                {actionLoading ? "Processing..." : "Cancel Job"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Grid Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 bg-white border border-slate-200 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Job Identity & Source
          </h2>
          <div className="text-sm space-y-2">
            <div>
              <span className="text-slate-400 block text-xs">Job ID</span>
              <span className="font-mono text-slate-800">{job.id}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Idempotency Key</span>
              <span className="font-mono text-slate-800">{job.idempotencyKey}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Source Binding</span>
              <span className="text-slate-800">
                {job.sourceType ? `${job.sourceType} #${job.sourceId}` : "None (Direct action)"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Execution Attempts</span>
              <span className="text-slate-800 font-semibold">
                {job.attemptCount} of {job.maxAttempts} max
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-white border border-slate-200 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Execution Timestamps
          </h2>
          <div className="text-sm space-y-2">
            <div>
              <span className="text-slate-400 block text-xs">Created At</span>
              <span className="text-slate-800">{new Date(job.createdAt).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Started At</span>
              <span className="text-slate-800">
                {job.startedAt ? new Date(job.startedAt).toLocaleString() : "Not started"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Completed At</span>
              <span className="text-slate-800">
                {job.completedAt ? new Date(job.completedAt).toLocaleString() : "Not completed"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Worker Lease</span>
              <span className="text-slate-800 font-mono text-xs">
                {job.leaseUntil ? new Date(job.leaseUntil).toISOString() : "None"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Error Card if exists */}
      {(job.lastErrorCode || job.lastErrorMessage) && (
        <Card className="p-6 bg-red-50 border border-red-200 space-y-2">
          <h2 className="text-sm font-bold text-red-900 uppercase tracking-wider">
            Last Error Encountered
          </h2>
          <div className="text-sm text-red-800 space-y-1">
            <div><strong>Code:</strong> {job.lastErrorCode || "UNKNOWN"}</div>
            <div><strong>Message:</strong> {job.lastErrorMessage}</div>
          </div>
        </Card>
      )}

      {/* Result Card if exists */}
      {job.resultJson && (
        <Card className="p-6 bg-white border border-slate-200 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Execution Result
          </h2>
          {job.resultJson?.postId && (
            <div className="p-3 bg-emerald-50 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
              <span>Post generated successfully in <strong>AI_DRAFT</strong> status.</span>
              <Link
                href={`/content/${job.resultJson.postId}`}
                className="font-bold underline ml-2"
              >
                Open Article in CMS Editor →
              </Link>
            </div>
          )}
          <pre className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 overflow-x-auto">
            {JSON.stringify(job.resultJson, null, 2)}
          </pre>
        </Card>
      )}

      {/* Payload Card */}
      <Card className="p-6 bg-white border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          Job Payload
        </h2>
        <pre className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 overflow-x-auto">
          {JSON.stringify(job.payloadJson, null, 2)}
        </pre>
      </Card>
    </div>
  );
}
