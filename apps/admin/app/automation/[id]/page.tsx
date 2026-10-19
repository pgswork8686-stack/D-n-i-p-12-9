"use client";

import { jobStatusLabel, jobTypeLabel } from "../../lib/catalog-labels";
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
        setError("Không có quyền truy cập (401). Vui lòng đăng nhập.");
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
      setError(err.message || "Không tải được chi tiết tác vụ.");
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
      alert(`Thử lại thất bại: ${err.message}`);
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
      alert(`Hủy thất bại: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-slate-400">
        Đang tải chi tiết tác vụ…
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Link href="/automation" className="text-sm text-[#0037b0] hover:underline">
          ← Tác vụ tự động
        </Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error || "Không tìm thấy tác vụ."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Top Breadcrumb & Header */}
      <div className="space-y-2">
        <Link href="/automation" className="text-sm text-[#0037b0] hover:underline">
          ← Tác vụ tự động
        </Link>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{jobTypeLabel(job.type)}</h1>
            <Badge variant={STATUS_COLORS[job.status] || "info"}>
              {jobStatusLabel(job.status)}
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
                {actionLoading ? "Đang xử lý…" : "🔄 Thử lại tác vụ"}
              </Button>
            )}
            {job.status === "PENDING" && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                onClick={handleCancel}
              >
                {actionLoading ? "Đang xử lý…" : "Hủy tác vụ"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Grid Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 bg-white border border-slate-200 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Mã tác vụ & nguồn
          </h2>
          <div className="text-sm space-y-2">
            <div>
              <span className="text-slate-400 block text-xs">Mã tác vụ</span>
              <span className="font-mono text-slate-800">{job.id}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Khóa chống trùng (idempotency)</span>
              <span className="font-mono text-slate-800">{job.idempotencyKey}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Nguồn</span>
              <span className="text-slate-800">
                {job.sourceType ? `${job.sourceType} #${job.sourceId}` : "Không có (thao tác trực tiếp)"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Số lần chạy</span>
              <span className="text-slate-800 font-semibold">
                {job.attemptCount} of {job.maxAttempts} max
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-white border border-slate-200 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Thời gian thực thi
          </h2>
          <div className="text-sm space-y-2">
            <div>
              <span className="text-slate-400 block text-xs">Tạo lúc</span>
              <span className="text-slate-800">{new Date(job.createdAt).toLocaleString("vi-VN")}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Bắt đầu lúc</span>
              <span className="text-slate-800">
                {job.startedAt ? new Date(job.startedAt).toLocaleString("vi-VN") : "Chưa bắt đầu"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Hoàn thành lúc</span>
              <span className="text-slate-800">
                {job.completedAt ? new Date(job.completedAt).toLocaleString("vi-VN") : "Chưa hoàn thành"}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">Worker đang giữ</span>
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
            Lỗi gần nhất
          </h2>
          <div className="text-sm text-red-800 space-y-1">
            <div><strong>Mã lỗi:</strong> {job.lastErrorCode || "KHÔNG RÕ"}</div>
            <div><strong>Nội dung:</strong> {job.lastErrorMessage}</div>
          </div>
        </Card>
      )}

      {/* Result Card if exists */}
      {job.resultJson && (
        <Card className="p-6 bg-white border border-slate-200 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Kết quả thực thi
          </h2>
          {job.resultJson?.postId && (
            <div className="p-3 bg-emerald-50 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
              <span>Đã tạo bài viết ở trạng thái <strong>AI_DRAFT</strong>.</span>
              <Link
                href={`/content/${job.resultJson.postId}`}
                className="font-bold underline ml-2"
              >
                Mở bài viết trong trình soạn thảo →
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
          Dữ liệu đầu vào
        </h2>
        <pre className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 overflow-x-auto">
          {JSON.stringify(job.payloadJson, null, 2)}
        </pre>
      </Card>
    </div>
  );
}
