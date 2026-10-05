import type { AiContextContent, WeeklyMarketingReview } from "@nexus/contracts";
import type { BaseMeasures } from "@nexus/utils";
import { ToolDefinition, ToolRegistry } from "./tools";

/**
 * Ports implemented by the API (Prisma, tenant-scoped). Tools receive the tenant from the
 * execution context; there is deliberately NO tool that runs arbitrary SQL.
 */
export interface MarketingPorts {
  loadContext(tenantId: string): Promise<{
    merged: AiContextContent;
    versions: Record<string, { contextId: string; version: number } | null>;
  }>;
  getPeriodMeasures(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<{ totals: BaseMeasures; byChannel: { channel: string; totals: BaseMeasures }[]; daysWithData: number; currency: string }>;
  getCampaigns(tenantId: string, from: string, to: string): Promise<{ channel: string; campaignKey: string; campaignName: string; totals: BaseMeasures }[]>;
  getSeoPages(tenantId: string, from: string, to: string): Promise<{ page: string; impressions: number; clicks: number; averagePosition: number | null }[]>;
  createReportDraft(input: { tenantId: string; executionId: string; userId: string; kind: string; title: string; body: WeeklyMarketingReview }): Promise<{ id: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertPeriod(input: { from?: unknown; to?: unknown }): { from: string; to: string } {
  if (typeof input?.from !== "string" || typeof input?.to !== "string" || !DATE_RE.test(input.from) || !DATE_RE.test(input.to) || input.from > input.to) {
    throw new Error("Khoảng thời gian không hợp lệ");
  }
  return { from: input.from, to: input.to };
}

/** High-risk tools are registered so the approval flow is real, but Phase 19 only simulates them. */
function dryRunHighRisk(name: string, description: string): ToolDefinition {
  return {
    name,
    risk: "WRITE_HIGH_RISK",
    description,
    handler: async (_ctx, input) => ({
      applied: false,
      dryRun: true,
      message: "Phase 19 chỉ mô phỏng hành động rủi ro cao; chưa có tích hợp thay đổi thật.",
      input,
    }),
  };
}

export function createMarketingToolRegistry(ports: MarketingPorts): ToolRegistry {
  return new ToolRegistry()
    .register({
      name: "context.load",
      risk: "READ",
      description: "Đọc context marketing đã gộp (SYSTEM → ORGANIZATION → CLIENT) của tenant.",
      handler: (ctx) => ports.loadContext(ctx.tenantId),
    })
    .register({
      name: "analytics.get_period_measures",
      risk: "READ",
      description: "Đọc tổng chỉ số gốc theo kỳ và theo kênh của tenant (không có SQL tuỳ ý).",
      handler: (ctx, input) => {
        const p = assertPeriod(input);
        return ports.getPeriodMeasures(ctx.tenantId, p.from, p.to);
      },
    })
    .register({
      name: "analytics.get_campaigns",
      risk: "READ",
      description: "Đọc chỉ số gốc theo chiến dịch của tenant.",
      handler: (ctx, input) => {
        const p = assertPeriod(input);
        return ports.getCampaigns(ctx.tenantId, p.from, p.to);
      },
    })
    .register({
      name: "seo.get_page_metrics",
      risk: "READ",
      description: "Đọc hiển thị, lượt nhấp và vị trí trung bình theo trang của tenant.",
      handler: (ctx, input) => {
        const p = assertPeriod(input);
        return ports.getSeoPages(ctx.tenantId, p.from, p.to);
      },
    })
    .register({
      name: "report.create_draft",
      risk: "WRITE_LOW_RISK",
      description: "Lưu báo cáo dạng nháp (không gửi, không xuất bản).",
      handler: (ctx, input: { kind: string; title: string; body: WeeklyMarketingReview }) =>
        ports.createReportDraft({ tenantId: ctx.tenantId, executionId: ctx.executionId, userId: ctx.userId, kind: input.kind, title: input.title, body: input.body }),
    })
    .register(dryRunHighRisk("ads.update_budget", "Đổi ngân sách quảng cáo (luôn cần người duyệt)."))
    .register(dryRunHighRisk("content.publish", "Xuất bản nội dung (luôn cần người duyệt)."));
}
