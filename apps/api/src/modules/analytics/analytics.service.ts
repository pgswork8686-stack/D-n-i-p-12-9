import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@nexus/database";
import {
  BASE_MEASURES,
  BaseMeasures,
  DERIVED_METRICS,
  computeDerivedMetrics,
  emptyBaseMeasures,
  percentChange,
  sumBaseMeasures,
} from "@nexus/utils";
import type {
  AnalyticsCampaignsDto,
  AnalyticsClientDto,
  AnalyticsFunnelDto,
  AnalyticsMetricDefinitionDto,
  AnalyticsOverviewDto,
} from "@nexus/contracts";
import { AccessibleTenant, AuthUser, TenantAccessService } from "../tenants/tenant-access.service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const DAY = 86_400_000;

export interface Period {
  from: string;
  to: string;
}

function toDate(s: string) {
  return new Date(`${s}T00:00:00Z`);
}
function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

type SumRow = {
  spendMinor?: bigint | null;
  impressions?: bigint | null;
  clicks?: bigint | null;
  sessions?: bigint | null;
  leads?: number | null;
  qualifiedLeads?: number | null;
  customers?: number | null;
  revenueMinor?: bigint | null;
};

/** Converts a Prisma _sum row of fact_marketing_daily into registry base measures. */
export function toBaseMeasures(sum: SumRow | null | undefined): BaseMeasures {
  if (!sum) return emptyBaseMeasures();
  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  return {
    spend: n(sum.spendMinor),
    impressions: n(sum.impressions),
    clicks: n(sum.clicks),
    sessions: n(sum.sessions),
    leads: n(sum.leads),
    qualified_leads: n(sum.qualifiedLeads),
    customers: n(sum.customers),
    revenue: n(sum.revenueMinor),
  };
}

const SUM_FIELDS = { spendMinor: true, impressions: true, clicks: true, sessions: true, leads: true, qualifiedLeads: true, customers: true, revenueMinor: true } as const;

/**
 * Read side of the marketing warehouse. Every query is filtered by the client id returned by
 * TenantAccessService (never by a value the browser chose without an access check), and every
 * ratio is computed from summed base measures by the metric registry.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly tenants: TenantAccessService) {}

  parsePeriod(from?: string, to?: string): Period {
    const end = to ?? fmt(new Date(Date.now() - DAY));
    const start = from ?? fmt(new Date(toDate(end).getTime() - 6 * DAY));
    for (const v of [start, end]) {
      if (!DATE_RE.test(v) || fmt(toDate(v)) !== v) throw new BadRequestException("Ngày phải có dạng YYYY-MM-DD");
    }
    if (start > end) throw new BadRequestException("from phải trước hoặc bằng to");
    if ((toDate(end).getTime() - toDate(start).getTime()) / DAY + 1 > MAX_RANGE_DAYS) throw new BadRequestException(`Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`);
    return { from: start, to: end };
  }

  previousPeriod(p: Period): Period {
    const len = (toDate(p.to).getTime() - toDate(p.from).getTime()) / DAY + 1;
    const prevTo = new Date(toDate(p.from).getTime() - DAY);
    return { from: fmt(new Date(prevTo.getTime() - (len - 1) * DAY)), to: fmt(prevTo) };
  }

  clientDto(t: AccessibleTenant): AnalyticsClientDto {
    return { id: t.id, slug: t.slug, name: t.name, currency: t.defaultCurrency, timezone: t.timezone, organizationId: t.parentId };
  }

  async listClients(user: AuthUser): Promise<AnalyticsClientDto[]> {
    return (await this.tenants.listAccessible(user, "CLIENT")).map((t) => this.clientDto(t));
  }

  metricDefinitions(): AnalyticsMetricDefinitionDto[] {
    return DERIVED_METRICS.map((d) => ({ key: d.key, label: d.label, unit: d.unit, formula: d.formula, description: d.description }));
  }

  /** Tenant-scoped base measures for a period (also used by the AI workflow ports). */
  async periodMeasures(clientId: string, p: Period) {
    const where = { clientId, date: { gte: toDate(p.from), lte: toDate(p.to) } };
    const [byChannel, days] = await Promise.all([
      prisma.factMarketingDaily.groupBy({ by: ["channelKey"], where, _sum: SUM_FIELDS }),
      prisma.factMarketingDaily.groupBy({ by: ["date"], where, _sum: SUM_FIELDS, orderBy: { date: "asc" } }),
    ]);
    const channels = byChannel.map((c) => ({ channel: c.channelKey, totals: toBaseMeasures(c._sum) })).sort((a, b) => b.totals.spend - a.totals.spend);
    return {
      totals: sumBaseMeasures(channels.map((c) => c.totals)),
      byChannel: channels,
      daily: days.map((d) => ({ date: fmt(d.date), totals: toBaseMeasures(d._sum) })),
      daysWithData: days.length,
    };
  }

  async overview(user: AuthUser, clientId: string, from?: string, to?: string): Promise<AnalyticsOverviewDto> {
    const tenant = await this.tenants.assertAccess(user, clientId, { type: "CLIENT" });
    const period = this.parsePeriod(from, to);
    const previousPeriod = this.previousPeriod(period);
    const [cur, prev] = await Promise.all([this.periodMeasures(tenant.id, period), this.periodMeasures(tenant.id, previousPeriod)]);
    const metrics = computeDerivedMetrics(cur.totals);
    const previousMetrics = computeDerivedMetrics(prev.totals);
    const change: Record<string, number | null> = {};
    for (const m of BASE_MEASURES) change[m] = percentChange(cur.totals[m], prev.totals[m]);
    for (const d of DERIVED_METRICS) change[d.key] = percentChange(metrics[d.key], previousMetrics[d.key]);
    return {
      client: this.clientDto(tenant),
      period,
      previousPeriod,
      totals: cur.totals,
      metrics,
      previousTotals: prev.totals,
      previousMetrics,
      change,
      byChannel: cur.byChannel.map((c) => ({ ...c, metrics: computeDerivedMetrics(c.totals) })),
      daily: cur.daily,
    };
  }

  async campaigns(user: AuthUser, clientId: string, from?: string, to?: string): Promise<AnalyticsCampaignsDto> {
    const tenant = await this.tenants.assertAccess(user, clientId, { type: "CLIENT" });
    const period = this.parsePeriod(from, to);
    const rows = await this.campaignRows(tenant.id, period);
    return { client: this.clientDto(tenant), period, campaigns: rows.map((r) => ({ ...r, metrics: computeDerivedMetrics(r.totals) })) };
  }

  async campaignRows(clientId: string, p: Period) {
    const rows = await prisma.factMarketingDaily.groupBy({
      by: ["channelKey", "campaignKey"],
      where: { clientId, date: { gte: toDate(p.from), lte: toDate(p.to) } },
      _sum: SUM_FIELDS,
    });
    const names = await prisma.dimCampaign.findMany({ where: { clientId }, select: { channelKey: true, externalId: true, name: true } });
    const nameOf = (ch: string, key: string) => names.find((n) => n.channelKey === ch && n.externalId === key)?.name ?? (key === "_all" ? "(không theo chiến dịch)" : key);
    return rows
      .map((r) => ({ channel: r.channelKey, campaignKey: r.campaignKey, campaignName: nameOf(r.channelKey, r.campaignKey), totals: toBaseMeasures(r._sum) }))
      .sort((a, b) => b.totals.spend - a.totals.spend);
  }

  async funnel(user: AuthUser, clientId: string, from?: string, to?: string): Promise<AnalyticsFunnelDto> {
    const tenant = await this.tenants.assertAccess(user, clientId, { type: "CLIENT" });
    const period = this.parsePeriod(from, to);
    const where = { clientId: tenant.id, date: { gte: toDate(period.from), lte: toDate(period.to) } };
    const funnel = await prisma.factLeadFunnelDaily.aggregate({ where, _sum: { sessions: true, leads: true, qualifiedLeads: true, opportunities: true, customers: true }, _count: true });
    let values: Record<string, number>;
    if (funnel._count > 0) {
      const s = funnel._sum;
      values = { sessions: Number(s.sessions ?? 0), leads: s.leads ?? 0, qualified_leads: s.qualifiedLeads ?? 0, opportunities: s.opportunities ?? 0, customers: s.customers ?? 0 };
    } else {
      // No dedicated funnel feed: fall back to the marketing facts (no opportunity stage).
      const m = (await this.periodMeasures(tenant.id, period)).totals;
      values = { sessions: m.sessions, leads: m.leads, qualified_leads: m.qualified_leads, opportunities: 0, customers: m.customers };
    }
    const order = ["sessions", "leads", "qualified_leads", "opportunities", "customers"] as const;
    const stages = order
      .filter((s) => s !== "opportunities" || values.opportunities > 0)
      .map((stage, i, arr) => {
        const prevStage = i > 0 ? values[arr[i - 1]] : null;
        return { stage, value: values[stage], conversionFromPrevious: prevStage ? Math.round((values[stage] / prevStage) * 1e6) / 1e6 : null };
      });
    return { client: this.clientDto(tenant), period, stages };
  }

  async seoPages(clientId: string, p: Period) {
    const rows = await prisma.factSeoDaily.groupBy({
      by: ["pageKey"],
      where: { clientId, date: { gte: toDate(p.from), lte: toDate(p.to) } },
      _sum: { impressions: true, clicks: true, positionSum: true },
      orderBy: { _sum: { impressions: "desc" } },
      take: 100,
    });
    return rows.map((r) => {
      const impressions = Number(r._sum.impressions ?? 0);
      return { page: r.pageKey, impressions, clicks: Number(r._sum.clicks ?? 0), averagePosition: impressions > 0 ? Math.round(((r._sum.positionSum ?? 0) / impressions) * 100) / 100 : null };
    });
  }
}
