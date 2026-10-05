/**
 * Phase 19 — Marketing analytics contracts (ingestion + read API).
 * Money values are integer minor units in the client's currency.
 */

export type AnalyticsIngestKind = "MARKETING_DAILY" | "LEAD_FUNNEL_DAILY" | "REVENUE_DAILY" | "SEO_DAILY";

export interface MarketingDailyRecord {
  /** YYYY-MM-DD in the client's time zone. */
  date: string;
  /** Canonical channel key (see analytics.dim_channel), e.g. google_ads, meta_ads. */
  channel: string;
  campaignId?: string;
  campaignName?: string;
  spendMinor: number;
  impressions: number;
  clicks: number;
  sessions?: number;
  leads?: number;
  qualifiedLeads?: number;
  customers?: number;
  revenueMinor?: number;
}

export interface LeadFunnelDailyRecord {
  date: string;
  channel: string;
  sessions: number;
  leads: number;
  qualifiedLeads: number;
  opportunities?: number;
  customers: number;
}

export interface RevenueDailyRecord {
  date: string;
  channel: string;
  productId?: string;
  productName?: string;
  orders: number;
  revenueMinor: number;
  refundsMinor?: number;
}

export interface SeoDailyRecord {
  date: string;
  page: string;
  query?: string;
  impressions: number;
  clicks: number;
  /** Average position for the row (1 = top). Stored as position * impressions for correct averaging. */
  averagePosition: number;
  sessions?: number;
}

/** Body of POST /internal/analytics/ingest (HMAC-signed by the connector, see docs). */
export interface AnalyticsIngestRequest {
  /** Unique per batch and source; replays with the same key are idempotent. */
  idempotencyKey: string;
  /** Connector identifier, e.g. "n8n.google-ads". */
  source: string;
  /** CLIENT tenant id that owns every record in the batch. */
  clientId: string;
  /** When the source system produced the data (ISO-8601). */
  eventTimestamp: string;
  kind: AnalyticsIngestKind;
  currency?: "VND" | "USD";
  records: Array<MarketingDailyRecord | LeadFunnelDailyRecord | RevenueDailyRecord | SeoDailyRecord>;
}

export interface AnalyticsIngestResponse {
  batchId: string;
  status: "NORMALIZED";
  duplicate: boolean;
  recordCount: number;
}

export interface AnalyticsBaseMeasuresDto {
  spend: number;
  impressions: number;
  clicks: number;
  sessions: number;
  leads: number;
  qualified_leads: number;
  customers: number;
  revenue: number;
}

export interface AnalyticsDerivedMetricsDto {
  ctr: number | null;
  cpc: number | null;
  cpl: number | null;
  cpql: number | null;
  cac: number | null;
  roas: number | null;
  cvr: number | null;
}

export interface AnalyticsPeriodDto {
  from: string;
  to: string;
}

export interface AnalyticsClientDto {
  id: string;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  organizationId: string | null;
}

export interface AnalyticsOverviewDto {
  client: AnalyticsClientDto;
  period: AnalyticsPeriodDto;
  previousPeriod: AnalyticsPeriodDto;
  totals: AnalyticsBaseMeasuresDto;
  metrics: AnalyticsDerivedMetricsDto;
  previousTotals: AnalyticsBaseMeasuresDto;
  previousMetrics: AnalyticsDerivedMetricsDto;
  /** Relative change per base measure and derived metric (0.1 = +10%). */
  change: Record<string, number | null>;
  byChannel: Array<{ channel: string; totals: AnalyticsBaseMeasuresDto; metrics: AnalyticsDerivedMetricsDto }>;
  daily: Array<{ date: string; totals: AnalyticsBaseMeasuresDto }>;
}

export interface AnalyticsCampaignRowDto {
  channel: string;
  campaignKey: string;
  campaignName: string;
  totals: AnalyticsBaseMeasuresDto;
  metrics: AnalyticsDerivedMetricsDto;
}

export interface AnalyticsCampaignsDto {
  client: AnalyticsClientDto;
  period: AnalyticsPeriodDto;
  campaigns: AnalyticsCampaignRowDto[];
}

export interface AnalyticsFunnelDto {
  client: AnalyticsClientDto;
  period: AnalyticsPeriodDto;
  stages: Array<{ stage: "sessions" | "leads" | "qualified_leads" | "opportunities" | "customers"; value: number; conversionFromPrevious: number | null }>;
}

export interface AnalyticsMetricDefinitionDto {
  key: string;
  label: string;
  unit: "ratio" | "money" | "multiplier";
  formula: string;
  description: string;
}
