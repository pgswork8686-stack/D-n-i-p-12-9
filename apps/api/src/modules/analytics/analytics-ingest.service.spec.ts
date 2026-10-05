import { BadRequestException } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics-ingest.service";
import { AnalyticsIngestDto } from "./analytics-ingest.dto";

const svc = new AnalyticsIngestService({} as any);

function dto(records: Record<string, unknown>[], kind: AnalyticsIngestDto["kind"] = "MARKETING_DAILY"): AnalyticsIngestDto {
  return { idempotencyKey: "batch-0001", source: "n8n.google-ads", clientId: "00000000-0000-4000-8000-000000000001", eventTimestamp: "2031-03-10T00:00:00Z", kind, records } as AnalyticsIngestDto;
}
const row = { date: "2024-03-10", channel: "google_ads", spendMinor: 1000, impressions: 100, clicks: 10, leads: 2, qualifiedLeads: 1 };

function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as any).errors;
  }
  throw new Error("expected BadRequestException");
}

describe("AnalyticsIngestService.validateRecords", () => {
  it("accepts valid base measures", () => {
    expect(svc.validateRecords(dto([row]))).toHaveLength(1);
  });

  it.each(["ctr", "CPC", "roas", "cpl", "conversionRate"])("rejects client-calculated KPI field %s", (field) => {
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, [field]: 0.5 }])))[0]).toMatch(/backend tự tính/);
  });

  it("rejects unknown fields, negative or fractional measures and bad dates", () => {
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, foo: 1 }])))[0]).toMatch(/foo/);
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, spendMinor: -1 }])))[0]).toMatch(/spendMinor/);
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, clicks: 1.5 }])))[0]).toMatch(/clicks/);
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, date: "2024-02-30" }])))[0]).toMatch(/date/);
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, date: "2099-01-01" }])))[0]).toMatch(/date/);
  });

  it("rejects inconsistent funnels and duplicate rows in a batch", () => {
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, qualifiedLeads: 5, leads: 2 }])))[0]).toMatch(/qualifiedLeads/);
    expect(errorsOf(() => svc.validateRecords(dto([{ ...row, clicks: 500, impressions: 100 }])))[0]).toMatch(/clicks/);
    expect(errorsOf(() => svc.validateRecords(dto([row, { ...row }])))[0]).toMatch(/trùng/);
  });

  it("validates SEO rows with page paths and average position", () => {
    const seo = { date: "2024-03-10", page: "/blog/a", impressions: 100, clicks: 5, averagePosition: 7.5 };
    expect(svc.validateRecords(dto([seo], "SEO_DAILY"))).toHaveLength(1);
    expect(errorsOf(() => svc.validateRecords(dto([{ ...seo, page: "http://evil" }], "SEO_DAILY")))[0]).toMatch(/page/);
  });
});
