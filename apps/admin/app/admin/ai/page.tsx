"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@nexus/ui";
import type { AiActionApprovalDto, AiContextDto, AiExecutionDto, AiSkillDto, AiToolDto, AnalyticsClientDto } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";

const SECTIONS: { key: string; label: string }[] = [
  { key: "productOverview", label: "Tổng quan sản phẩm" },
  { key: "targetAudience", label: "Khách hàng mục tiêu" },
  { key: "problems", label: "Vấn đề khách hàng" },
  { key: "positioning", label: "Định vị" },
  { key: "competition", label: "Đối thủ" },
  { key: "differentiation", label: "Điểm khác biệt" },
  { key: "brandVoice", label: "Giọng thương hiệu" },
  { key: "customerLanguage", label: "Ngôn ngữ khách hàng" },
  { key: "proofPoints", label: "Bằng chứng" },
  { key: "goals", label: "Mục tiêu" },
  { key: "metrics", label: "Chỉ số theo dõi" },
];

const RISK_VARIANT: Record<string, "success" | "warning" | "error"> = { READ: "success", WRITE_LOW_RISK: "warning", WRITE_HIGH_RISK: "error" };

/** Phase 19 — AI Marketing OS foundation: skills, context versions, executions and approvals. */
export default function AdminAiPage() {
  const { token, isLoading } = useAuth();
  const [status, setStatus] = useState<{ enabled: boolean; reason: string | null; provider: string } | null>(null);
  const [skills, setSkills] = useState<AiSkillDto[]>([]);
  const [tools, setTools] = useState<AiToolDto[]>([]);
  const [clients, setClients] = useState<AnalyticsClientDto[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [contexts, setContexts] = useState<AiContextDto[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [executions, setExecutions] = useState<any[]>([]);
  const [current, setCurrent] = useState<AiExecutionDto | null>(null);
  const [approvals, setApprovals] = useState<AiActionApprovalDto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = useCallback(() => getApiClient(token), [token]);
  const clientCtx = contexts.find((c) => c.scope === "CLIENT");

  useEffect(() => {
    if (!token) {
      if (!isLoading) setMessage("Vui lòng đăng nhập bằng tài khoản quản trị.");
      return;
    }
    const a = api();
    Promise.all([a.getAiStatus(), a.listAiSkills(), a.listAiTools(), a.listAnalyticsClients()])
      .then(([st, sk, tl, cl]) => {
        setStatus(st);
        setSkills(sk);
        setTools(tl);
        setClients(cl);
        setTenantId((t) => t || cl[0]?.id || "");
      })
      .catch((e) => setMessage(e.message));
  }, [token, isLoading, api]);

  const loadTenant = useCallback(async () => {
    if (!token || !tenantId) return;
    const a = api();
    const [ctx, ex, ap] = await Promise.all([a.listAiContexts(tenantId), a.listAiExecutions(tenantId), a.listAiApprovals(tenantId)]);
    setContexts(ctx);
    setExecutions(ex);
    setApprovals(ap);
    setDraft(((ctx.find((c) => c.scope === "CLIENT")?.current?.content as Record<string, string>) ?? {}));
  }, [token, tenantId, api]);

  useEffect(() => {
    loadTenant().catch((e) => setMessage(e.message));
  }, [loadTenant]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(null);
    try {
      const m = await fn();
      if (m) setMessage(m);
      await loadTenant();
    } catch (e: any) {
      setMessage(`Lỗi: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Marketing OS</h1>
          <p className="text-sm text-slate-500">
            Trạng thái: {status ? (status.enabled ? `đang bật (nhà cung cấp: ${status.provider})` : `đang tắt — ${status.reason}`) : "…"}
          </p>
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Khách hàng
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? <div className={`p-4 rounded-xl text-sm ${message.startsWith("Lỗi") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{message}</div> : null}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Skills" subtitle="Nạp từ ai/skills, kiểm tra khi khởi động">
          <ul className="space-y-3 text-sm">
            {skills.map((s) => (
              <li key={s.name}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{s.name}</span>
                  <span className="text-xs text-slate-400">v{s.version}</span>
                  <Badge variant={RISK_VARIANT[s.maxRisk]}>{s.maxRisk}</Badge>
                </div>
                <p className="text-xs text-slate-500">{s.description}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Công cụ và mức rủi ro" subtitle="WRITE_HIGH_RISK luôn cần người khác phê duyệt">
          <ul className="space-y-2 text-sm">
            {tools.map((t) => (
              <li key={t.name} className="flex items-start gap-2">
                <Badge variant={RISK_VARIANT[t.risk]}>{t.risk}</Badge>
                <div>
                  <div className="font-mono text-xs text-slate-900">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.description}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Context của khách hàng" subtitle={`Phiên bản hiện tại: ${clientCtx?.currentVersion ?? 0}. Mỗi lần lưu tạo phiên bản mới, không ghi đè.`}>
        <div className="grid md:grid-cols-2 gap-4">
          {SECTIONS.map((s) => (
            <label key={s.key} className="text-xs font-semibold text-slate-600">
              {s.label}
              <textarea
                rows={3}
                value={draft[s.key] ?? ""}
                onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="text-xs font-semibold text-slate-600 flex-1 min-w-[240px]">
            Lý do thay đổi (bắt buộc)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <Button
            variant="primary"
            disabled={busy === "ctx" || reason.trim().length < 3 || !tenantId}
            onClick={() =>
              run("ctx", async () => {
                const content = Object.fromEntries(Object.entries(draft).filter(([, v]) => v && v.trim()));
                const saved = await api().createAiContextVersion({ scope: "CLIENT", tenantId, content, changeReason: reason, baseVersion: clientCtx?.currentVersion ?? 0 });
                setReason("");
                return `Đã lưu context phiên bản ${saved.currentVersion}.`;
              })
            }
          >
            Lưu phiên bản mới
          </Button>
        </div>
      </Card>

      <Card
        title="Tổng kết marketing tuần"
        subtitle="Workflow weekly-marketing-review: chỉ đọc dữ liệu và tạo báo cáo nháp, không tự thay đổi quảng cáo"
        headerAction={
          <Button
            variant="primary"
            disabled={busy === "run" || !tenantId}
            onClick={() =>
              run("run", async () => {
                const ex = await api().createAiExecution({ workflow: "weekly-marketing-review", tenantId });
                setCurrent(ex);
                return ex.status === "SUCCEEDED" ? `Hoàn tất: ${ex.resultSummary}` : `Thất bại: ${ex.error}`;
              })
            }
          >
            {busy === "run" ? "Đang chạy..." : "Chạy ngay"}
          </Button>
        }
      >
        <div className="grid lg:grid-cols-3 gap-6">
          <ul className="space-y-2 text-sm">
            {executions.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => api().getAiExecution(e.id).then(setCurrent)} className="text-left hover:underline">
                  <Badge variant={e.status === "SUCCEEDED" ? "success" : e.status === "FAILED" ? "error" : "warning"}>{e.status}</Badge>{" "}
                  <span className="text-slate-700">{new Date(e.startedAt).toLocaleString("vi-VN")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="lg:col-span-2 text-sm space-y-3">
            {current?.result ? (
              <>
                <div className="font-semibold text-slate-900">{current.result.summary.headline}</div>
                <p className="text-slate-600">{current.result.summary.narrative}</p>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Bất thường</div>
                  <ul className="list-disc ml-5">
                    {current.result.anomalies.map((a, i) => (
                      <li key={i}>{a.message}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Đề xuất</div>
                  <ul className="space-y-1">
                    {current.result.recommendations.map((r) => (
                      <li key={r.id}>
                        <span className="font-medium">{r.title}</span> — {r.rationale}
                        {r.proposedAction?.requiresApproval ? <span className="text-xs text-amber-600 ml-2">(cần phê duyệt: {r.proposedAction.tool})</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-slate-400">
                  Độ tin cậy {Math.round(current.result.confidence.score * 100)}% · {current.steps.length} bước được ghi audit · context:{" "}
                  {Object.entries(current.contextVersions)
                    .map(([k, v]) => `${k} v${v?.version ?? "–"}`)
                    .join(", ")}
                </p>
              </>
            ) : (
              <p className="text-slate-400">Chọn một lượt chạy để xem kết quả.</p>
            )}
          </div>
        </div>
      </Card>

      <Card title="Yêu cầu phê duyệt" subtitle="Hành động rủi ro cao. Người yêu cầu không thể tự duyệt.">
        <ul className="divide-y divide-slate-100 text-sm">
          {approvals.length === 0 ? <li className="py-3 text-slate-400">Không có yêu cầu nào.</li> : null}
          {approvals.map((a) => (
            <li key={a.id} className="py-3 flex flex-wrap items-center gap-3">
              <Badge variant={a.status === "PENDING" ? "warning" : a.status === "APPROVED" ? "success" : "error"}>{a.status}</Badge>
              <span className="font-mono text-xs">{a.tool}</span>
              <span className="text-xs text-slate-500 flex-1 truncate">{JSON.stringify(a.payload)}</span>
              {a.status === "PENDING" ? (
                <span className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => run(`ap-${a.id}`, async () => void (await api().decideAiApproval(a.id, "APPROVED")))}>
                    Duyệt
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => run(`rj-${a.id}`, async () => void (await api().decideAiApproval(a.id, "REJECTED")))}>
                    Từ chối
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
