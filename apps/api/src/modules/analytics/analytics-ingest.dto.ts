import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const MAX_INGEST_RECORDS = 500;
const MAX_COUNT = 1_000_000_000_000; // generous upper bound; keeps values far below 2^53
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Envelope of POST /internal/analytics/ingest. Records are validated per kind in the service. */
export class AnalyticsIngestDto {
  @IsString()
  @Matches(/^[A-Za-z0-9:_.-]{8,200}$/, { message: "idempotencyKey: 8-200 ký tự [A-Za-z0-9:_.-]" })
  idempotencyKey!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{1,63}$/, { message: "source không hợp lệ" })
  source!: string;

  @IsUUID("4")
  clientId!: string;

  @IsISO8601({ strict: true })
  eventTimestamp!: string;

  @IsIn(["MARKETING_DAILY", "LEAD_FUNNEL_DAILY", "REVENUE_DAILY", "SEO_DAILY"])
  kind!: "MARKETING_DAILY" | "LEAD_FUNNEL_DAILY" | "REVENUE_DAILY" | "SEO_DAILY";

  @IsOptional()
  @IsIn(["VND", "USD"])
  currency?: "VND" | "USD";

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INGEST_RECORDS)
  @IsObject({ each: true })
  records!: Record<string, unknown>[];
}

class RecordBase {
  @Matches(DATE, { message: "date phải có dạng YYYY-MM-DD" })
  date!: string;
}

export class MarketingDailyRecordDto extends RecordBase {
  @Matches(/^[a-z0-9_]{2,40}$/) channel!: string;
  @IsOptional() @IsString() @MaxLength(200) campaignId?: string;
  @IsOptional() @IsString() @MaxLength(300) campaignName?: string;
  @IsInt() @Min(0) @Max(MAX_COUNT) spendMinor!: number;
  @IsInt() @Min(0) @Max(MAX_COUNT) impressions!: number;
  @IsInt() @Min(0) @Max(MAX_COUNT) clicks!: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_COUNT) sessions?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) leads?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) qualifiedLeads?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) customers?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_COUNT) revenueMinor?: number;
}

export class LeadFunnelDailyRecordDto extends RecordBase {
  @Matches(/^[a-z0-9_]{2,40}$/) channel!: string;
  @IsInt() @Min(0) @Max(MAX_COUNT) sessions!: number;
  @IsInt() @Min(0) @Max(2_000_000_000) leads!: number;
  @IsInt() @Min(0) @Max(2_000_000_000) qualifiedLeads!: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) opportunities?: number;
  @IsInt() @Min(0) @Max(2_000_000_000) customers!: number;
}

export class RevenueDailyRecordDto extends RecordBase {
  @Matches(/^[a-z0-9_]{2,40}$/) channel!: string;
  @IsOptional() @IsString() @MaxLength(200) productId?: string;
  @IsOptional() @IsString() @MaxLength(300) productName?: string;
  @IsInt() @Min(0) @Max(2_000_000_000) orders!: number;
  @IsInt() @Min(0) @Max(MAX_COUNT) revenueMinor!: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_COUNT) refundsMinor?: number;
}

export class SeoDailyRecordDto extends RecordBase {
  @IsString() @MaxLength(500) @Matches(/^\/[^\s]*$/, { message: "page phải là đường dẫn bắt đầu bằng /" }) page!: string;
  @IsOptional() @IsString() @MaxLength(300) query?: string;
  @IsInt() @Min(0) @Max(MAX_COUNT) impressions!: number;
  @IsInt() @Min(0) @Max(MAX_COUNT) clicks!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(1000) averagePosition!: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_COUNT) sessions?: number;
}

export const RECORD_DTO_BY_KIND = {
  MARKETING_DAILY: MarketingDailyRecordDto,
  LEAD_FUNNEL_DAILY: LeadFunnelDailyRecordDto,
  REVENUE_DAILY: RevenueDailyRecordDto,
  SEO_DAILY: SeoDailyRecordDto,
} as const;
