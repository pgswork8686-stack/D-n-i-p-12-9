"use client";

import { jobStatusLabel, jobTypeLabel } from "../lib/catalog-labels";
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
        setError("Không có quyền truy cập (401). Vui lòng đăng nhập bằng tài khoản quản trị.");
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
      setError(err.message || "Không tải được danh sách tác vụ tự động.");
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
      alert(`Thử lại thất bại: ${err.message}`);
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
      setAiSuccessMsg(`Đã xếp hàng tác vụ tạo bản nháp AI: ${job.id}. Worker và n8n sẽ xử lý.`);
      setAiTopic("");
      setAiBrief("");
      setTimeout(() => {
        setShowAiModal(false);
        setAiSuccessMsg(null);
        fetchJobs();
      }, 2000);
    } catch (err: any) {
      alert(`Không xếp hàng được bản nháp AI: ${err.message}`);
    } finally {
      setAiSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tự động hóa & AI</h1>
          <p className="text-sm text-slate-500">
            Tác vụ nền, bản nháp AI và email/thông báo giao dịch
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
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Trạng thái:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="PENDING">Đang chờ</option>
              <option value="RUNNING">Đang chạy</option>
              <option value="SUCCEEDED">Thành công</option>
              <option value="FAILED">Thất bại</option>
              <option value="CANCELLED">Đã hủy</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Loại:</span>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0037b0]"
            >
              <option value="">Tất cả loại</option>
              <option value="CMS_AI_DRAFT">Bản nháp AI cho nội dung</option>
              <option value="ORDER_PAID_EMAIL">Email xác nhận thanh toán</option>
              <option value="LICENSE_PROVISIONED_EMAIL">Email giao license</option>
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
        <div className="relative overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Mã tác vụ / loại</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Số lần chạy</th>
                <th className="py-3 px-4">Nguồn</th>
                <th className="py-3 px-4">Thời gian</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Thao tác</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Đang tải tác vụ…
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Chưa có tác vụ nào.
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
                        {jobTypeLabel(job.type)}
                      </Link>
                      <span className="text-xs text-slate-400 font-mono">
                        {job.id.substring(0, 8)}...
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={STATUS_COLORS[job.status] || "info"}>
                        {jobStatusLabel(job.status)}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {job.sourceType ? `${job.sourceType}: ${job.sourceId?.substring(0, 8)}...` : "—"}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 space-y-0.5">
                      <div>Tạo lúc: {new Date(job.createdAt).toLocaleString("vi-VN")}</div>
                      {job.completedAt && (
                        <div>Xong lúc: {new Date(job.completedAt).toLocaleString("vi-VN")}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Link
                        href={`/automation/${job.id}`}
                        className="text-xs text-[#0037b0] hover:underline font-medium"
                      >
                        Xem
                      </Link>
                      {job.status === "FAILED" && (
                        <button
                          onClick={() => handleRetry(job.id)}
                          className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                        >
                          Thử lại
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
              Trang {page} / {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Sau
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
              <h2 className="text-lg font-bold text-slate-900">✨ Yêu cầu bản nháp AI</h2>
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
                  <label htmlFor="au-1" className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Chủ đề / ý tưởng tiêu đề *
                  </label>
                  <input id="au-1"
                    type="text"
                    required
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="e.g. Modern Headless Architecture in 2026"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="au-2" className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Dàn ý / các ý chính *
                  </label>
                  <textarea id="au-2"
                    rows={4}
                    required
                    value={aiBrief}
                    onChange={(e) => setAiBrief(e.target.value)}
                    placeholder="Nhập dàn ý, đối tượng, giọng văn hoặc điểm nổi bật của sản phẩm…"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="au-3" className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Ngôn ngữ
                  </label>
                  <select id="au-3"
                    value={aiLanguage}
                    onChange={(e) => setAiLanguage(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0037b0] focus:outline-none"
                  >
                    <option value="vi">Tiếng Việt (vi)</option>
                    <option value="en">Tiếng Anh (en)</option>
                  </select>
                </div>

                <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800">
                  ⚠️ Kết quả AI chỉ được lưu ở trạng thái <strong>AI_DRAFT</strong>. Biên tập viên bắt buộc phải duyệt trước khi xuất bản.
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setShowAiModal(false)}
                    disabled={aiSubmitting}
                  >
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={aiSubmitting}
                  >
                    {aiSubmitting ? "Đang gửi…" : "Gửi yêu cầu AI"}
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
