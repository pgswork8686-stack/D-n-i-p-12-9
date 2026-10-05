import type {
  AiContextContent,
  WeeklyMarketingReview,
  WeeklyReviewAnomaly,
  WeeklyReviewMetric,
  WeeklyReviewRecommendation,
} from "@nexus/contracts";
import {
  BaseMeasures,
  DERIVED_METRICS,
  computeDerivedMetrics,
  containsSecret,
  percentChange,
  redactSecretText,
} from "@nexus/utils";
import type { AiProvider } from "../provider";
import { StepRecorder, ToolContext, ToolRegistry, recordStep } from "../tools";
import { UNTRUSTED_DATA_INSTRUCTION, wrapUntrusted } from "../untrusted";
import { validateWeeklyReview } from "./weekly-review-schema";

/**
 * weekly-marketing-review
 *   load context → retrieve analytics → calculate KPI → compare period → identify anomalies
 *   → generate recommendations → create report draft
 *
 * Deterministic by design: KPIs, anomalies and recommendations are computed in code from the
 * metric registry. A model (if configured) only rewrites the narrative, receives the data as
 * untrusted input, cannot call tools, and its text is discarded if it fails validation.
 * The workflow never changes ads, budgets, prices or content: budget changes appear only as
 * proposals that require human approval.
 */
export const WEEKLY_REVIEW_WORKFLOW = {
  name: "weekly-marketing-review",
  version: "1.0.0",
  description: "Tổng kết marketing tuần: KPI, so sánh tuần trước, bất thường, đề xuất và báo cáo nháp.",
  skills: ["marketing-analytics", "campaign-analysis"],
  tools: ["context.load", "analytics.get_period_measures", "report.create_draft", "ads.update_budget"],
} as const;

export interface WeeklyReviewInput {
  /** Last day of the reviewed week (YYYY-MM-DD). */
  weekEnding: string;
}

const MIN_BASELINE: Partial<Record<keyof BaseMeasures, number>> = { spend: 1, leads: 5, customers: 2, revenue: 1, clicks: 20 };

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weeklyPeriods(weekEnding: string) {
  const to = weekEnding;
  const from = addDays(to, -6);
  return { from, to, previousFrom: addDays(from, -7), previousTo: addDays(from, -1) };
}

const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);

function buildMetrics(cur: BaseMeasures, prev: BaseMeasures): WeeklyReviewMetric[] {
  const curD = computeDerivedMetrics(cur);
  const prevD = computeDerivedMetrics(prev);
  const base: WeeklyReviewMetric[] = (
    [
      ["spend", "Chi phí", "money"],
      ["impressions", "Hiển thị", "count"],
      ["clicks", "Lượt nhấp", "count"],
      ["sessions", "Phiên truy cập", "count"],
      ["leads", "Khách tiềm năng", "count"],
      ["qualified_leads", "Khách tiềm năng đủ điều kiện", "count"],
      ["customers", "Khách hàng mới", "count"],
      ["revenue", "Doanh thu", "money"],
    ] as const
  ).map(([key, label, unit]) => ({ key, label, unit, current: cur[key], previous: prev[key], change: percentChange(cur[key], prev[key]) }));
  const derived: WeeklyReviewMetric[] = DERIVED_METRICS.map((d) => ({
    key: d.key,
    label: d.label,
    unit: d.unit === "money" ? "money" : d.unit === "multiplier" ? "multiplier" : "ratio",
    current: curD[d.key],
    previous: prevD[d.key],
    change: percentChange(curD[d.key], prevD[d.key]),
  }));
  return [...base, ...derived];
}

export function detectAnomalies(
  cur: BaseMeasures,
  prev: BaseMeasures,
  curChannels: { channel: string; totals: BaseMeasures }[],
): WeeklyReviewAnomaly[] {
  const anomalies: WeeklyReviewAnomaly[] = [];
  for (const key of ["spend", "leads", "customers", "revenue"] as const) {
    const change = percentChange(cur[key], prev[key]);
    if (change === null || prev[key] < (MIN_BASELINE[key] ?? 1) || Math.abs(change) < 0.25) continue;
    anomalies.push({
      metric: key,
      channel: null,
      severity: Math.abs(change) >= 0.5 ? "critical" : "warning",
      direction: change > 0 ? "up" : "down",
      change,
      message: `${key} thay đổi ${pct(change)} so với tuần trước.`,
    });
  }
  const curD = computeDerivedMetrics(cur);
  const prevD = computeDerivedMetrics(prev);
  for (const def of DERIVED_METRICS) {
    const change = percentChange(curD[def.key], prevD[def.key]);
    if (change === null || Math.abs(change) < 0.25) continue;
    const worse = def.higherIsBetter ? change < 0 : change > 0;
    if (!worse) continue;
    anomalies.push({
      metric: def.key,
      channel: null,
      severity: Math.abs(change) >= 0.5 ? "critical" : "warning",
      direction: change > 0 ? "up" : "down",
      change,
      message: `${def.label} xấu đi ${pct(change)} (${def.formula}).`,
    });
  }
  const overallCpl = curD.cpl;
  for (const ch of curChannels) {
    if (ch.totals.spend > 0 && ch.totals.leads === 0 && ch.totals.clicks >= 20) {
      anomalies.push({ metric: "leads", channel: ch.channel, severity: "warning", direction: "down", change: -1, message: `Kênh ${ch.channel} có chi phí nhưng không tạo ra khách tiềm năng nào.` });
      continue;
    }
    const cpl = computeDerivedMetrics(ch.totals).cpl;
    if (cpl !== null && overallCpl !== null && overallCpl > 0 && cpl >= overallCpl * 2 && ch.totals.leads >= 3) {
      anomalies.push({ metric: "cpl", channel: ch.channel, severity: "info", direction: "up", change: cpl / overallCpl - 1, message: `CPL kênh ${ch.channel} cao gấp ${Math.round((cpl / overallCpl) * 10) / 10} lần mức trung bình.` });
    }
  }
  return anomalies;
}

export function buildRecommendations(anomalies: WeeklyReviewAnomaly[]): WeeklyReviewRecommendation[] {
  const recs: WeeklyReviewRecommendation[] = [];
  const budgetProposal = { tool: "ads.update_budget", risk: "WRITE_HIGH_RISK" as const, requiresApproval: true };
  anomalies.forEach((a, i) => {
    if (a.channel && a.metric === "leads") {
      recs.push({ id: `rec-${i + 1}`, priority: "high", title: `Rà soát kênh ${a.channel}`, rationale: `${a.message} Kiểm tra theo dõi chuyển đổi, landing page và đối tượng; cân nhắc giảm ngân sách nếu vẫn không có lead.`, proposedAction: budgetProposal });
    } else if (a.channel && a.metric === "cpl") {
      recs.push({ id: `rec-${i + 1}`, priority: "medium", title: `Tối ưu chi phí kênh ${a.channel}`, rationale: `${a.message} Thử chuyển một phần ngân sách sang kênh có CPL thấp hơn sau khi được duyệt.`, proposedAction: budgetProposal });
    } else if (a.metric === "roas" || a.metric === "cac" || a.metric === "cpl" || a.metric === "cpql") {
      recs.push({ id: `rec-${i + 1}`, priority: a.severity === "critical" ? "high" : "medium", title: `Hiệu quả chi tiêu giảm (${a.metric.toUpperCase()})`, rationale: `${a.message} Xem chiến dịch nào kéo giảm hiệu quả trước khi tăng ngân sách.`, proposedAction: null });
    } else if (a.direction === "down") {
      recs.push({ id: `rec-${i + 1}`, priority: a.severity === "critical" ? "high" : "medium", title: `${a.metric} giảm mạnh`, rationale: `${a.message} Kiểm tra dữ liệu đầu vào và các thay đổi chiến dịch trong tuần.`, proposedAction: null });
    } else {
      recs.push({ id: `rec-${i + 1}`, priority: "low", title: `${a.metric} tăng mạnh`, rationale: `${a.message} Xác định nguyên nhân để nhân rộng nếu hiệu quả.`, proposedAction: null });
    }
  });
  if (recs.length === 0) {
    recs.push({ id: "rec-1", priority: "low", title: "Giữ chiến lược hiện tại", rationale: "Không phát hiện biến động đáng kể so với tuần trước. Tiếp tục theo dõi CPL và ROAS.", proposedAction: null });
  }
  return recs.slice(0, 10);
}

function deterministicNarrative(metrics: WeeklyReviewMetric[], anomalies: WeeklyReviewAnomaly[]): { headline: string; narrative: string } {
  const get = (k: string) => metrics.find((m) => m.key === k);
  const leads = get("leads");
  const roas = get("roas");
  const headline = anomalies.some((a) => a.severity === "critical")
    ? "Có biến động lớn cần xử lý trong tuần này"
    : anomalies.length
      ? "Hiệu quả marketing có vài điểm cần chú ý"
      : "Hiệu quả marketing ổn định so với tuần trước";
  const narrative = [
    `Khách tiềm năng: ${leads?.current ?? 0} (${pct(leads?.change ?? null)} so với tuần trước).`,
    `ROAS: ${roas?.current ?? "—"} (${pct(roas?.change ?? null)}).`,
    anomalies.length ? `Phát hiện ${anomalies.length} điểm bất thường.` : "Không có điểm bất thường.",
  ].join(" ");
  return { headline, narrative };
}

async function modelNarrative(provider: AiProvider, context: AiContextContent, facts: unknown, fallback: string): Promise<string> {
  const system =
    "Bạn là chuyên viên phân tích marketing. Viết 3-5 câu tiếng Việt tóm tắt hiệu quả tuần dựa DUY NHẤT trên số liệu được cung cấp. " +
    "Không bịa số liệu, không đưa liên kết, không đề xuất hành động tự động. " +
    UNTRUSTED_DATA_INSTRUCTION;
  const user = `${wrapUntrusted("business_context", context)}\n\n${wrapUntrusted("weekly_metrics", facts)}\n\nViết phần tóm tắt.`;
  const text = (await provider.complete({ system, user, maxTokens: 500 })).trim();
  if (!text || text.length > 2500 || containsSecret(text) || /https?:\/\//i.test(text)) return fallback;
  return redactSecretText(text);
}

export async function runWeeklyMarketingReview(args: {
  input: WeeklyReviewInput;
  tools: ToolRegistry;
  ctx: ToolContext;
  recorder: StepRecorder;
  provider: AiProvider;
}): Promise<{ review: WeeklyMarketingReview; reportDraftId: string; contextVersions: Record<string, unknown> }> {
  const { input, tools, ctx, recorder, provider } = args;
  const run = async <T>(name: string, payload: unknown): Promise<T> => {
    const out = await tools.invoke<T>(ctx, name, payload, recorder);
    if (out.outcome !== "EXECUTED") throw new Error(`Tool ${name} bị chặn: ${out.outcome === "DENIED" ? out.reason : "cần phê duyệt"}`);
    return out.result;
  };

  const periods = weeklyPeriods(input.weekEnding);
  const context = await run<{ merged: AiContextContent; versions: Record<string, unknown> }>("context.load", {});
  const current = await run<{ totals: BaseMeasures; byChannel: { channel: string; totals: BaseMeasures }[]; daysWithData: number; currency: string }>(
    "analytics.get_period_measures",
    { from: periods.from, to: periods.to },
  );
  const previous = await run<{ totals: BaseMeasures; daysWithData: number }>("analytics.get_period_measures", { from: periods.previousFrom, to: periods.previousTo });

  const metrics: WeeklyReviewMetric[] = await recordStep(recorder, "calculate_kpis_and_compare", "COMPUTE", { periods }, () => buildMetrics(current.totals, previous.totals));
  const anomalies: WeeklyReviewAnomaly[] = await recordStep(recorder, "identify_anomalies", "COMPUTE", { metricCount: metrics.length }, () =>
    detectAnomalies(current.totals, previous.totals, current.byChannel),
  );
  const recommendations: WeeklyReviewRecommendation[] = await recordStep(recorder, "generate_recommendations", "COMPUTE", { anomalyCount: anomalies.length }, () => buildRecommendations(anomalies));

  const dataQuality = current.daysWithData === 0 ? "no_data" : current.daysWithData < 7 || previous.daysWithData < 7 ? "partial" : "ok";
  const base = deterministicNarrative(metrics, anomalies);
  let narrative = base.narrative;
  if (provider.name !== "none" && dataQuality !== "no_data") {
    narrative = await recordStep(recorder, "write_narrative", "LLM", { provider: provider.name, model: provider.model }, () =>
      modelNarrative(provider, context.merged, { periods, metrics, anomalies }, base.narrative).catch(() => base.narrative),
    );
  }

  const confidenceReasons: string[] = [];
  let score = 0.9;
  if (dataQuality === "no_data") {
    score = 0.1;
    confidenceReasons.push("Không có dữ liệu trong kỳ.");
  } else if (dataQuality === "partial") {
    score = 0.6;
    confidenceReasons.push("Dữ liệu không đủ 7 ngày ở một trong hai kỳ.");
  } else confidenceReasons.push("Đủ dữ liệu 7 ngày cho cả hai kỳ.");
  if (Object.keys(context.merged).length === 0) {
    score = Math.max(0, score - 0.1);
    confidenceReasons.push("Chưa có context doanh nghiệp.");
  }

  const review: WeeklyMarketingReview = {
    schemaVersion: "1.0",
    period: { ...periods, currency: current.currency === "USD" ? "USD" : "VND" },
    summary: { headline: base.headline, narrative, dataQuality },
    metrics,
    anomalies,
    recommendations,
    confidence: { score: Math.round(score * 100) / 100, reasons: confidenceReasons },
  };
  const errors = validateWeeklyReview(review);
  if (errors.length) throw new Error(`Kết quả không đúng schema: ${errors.join("; ")}`);

  const draft = await run<{ id: string }>("report.create_draft", {
    kind: WEEKLY_REVIEW_WORKFLOW.name,
    title: `Tổng kết marketing ${periods.from} → ${periods.to}`,
    body: review,
  });
  return { review, reportDraftId: draft.id, contextVersions: context.versions };
}
