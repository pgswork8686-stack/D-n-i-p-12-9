import { BadRequestException } from "@nestjs/common";
import { AnalyticsService, toBaseMeasures } from "./analytics.service";
import { TenantAccessService } from "../tenants/tenant-access.service";

describe("AnalyticsService periods", () => {
  const svc = new AnalyticsService(new TenantAccessService());

  it("defaults to the 7 days ending yesterday and validates ranges", () => {
    const p = svc.parsePeriod("2031-03-10", "2031-03-16");
    expect(p).toEqual({ from: "2031-03-10", to: "2031-03-16" });
    expect(svc.previousPeriod(p)).toEqual({ from: "2031-03-03", to: "2031-03-09" });
    expect(() => svc.parsePeriod("2031-03-16", "2031-03-10")).toThrow(BadRequestException);
    expect(() => svc.parsePeriod("2031-02-30", "2031-03-10")).toThrow(BadRequestException);
    expect(() => svc.parsePeriod("2020-01-01", "2031-01-01")).toThrow(/tối đa/);
    expect(() => svc.parsePeriod("2031-03-10'; DROP TABLE x;--", "2031-03-11")).toThrow(BadRequestException);
  });

  it("converts BigInt sums into base measures", () => {
    expect(toBaseMeasures({ spendMinor: 10n, impressions: 5n, clicks: 1n, sessions: 2n, leads: 1, qualifiedLeads: 0, customers: 0, revenueMinor: 20n })).toEqual({
      spend: 10,
      impressions: 5,
      clicks: 1,
      sessions: 2,
      leads: 1,
      qualified_leads: 0,
      customers: 0,
      revenue: 20,
    });
    expect(toBaseMeasures(null).spend).toBe(0);
  });

  it("exposes the registry definitions instead of re-implementing formulas", () => {
    expect(svc.metricDefinitions().map((m) => m.key)).toEqual(["ctr", "cpc", "cpl", "cpql", "cac", "roas", "cvr"]);
  });
});

describe("TenantAccessService staff detection", () => {
  const t = new TenantAccessService();
  it("only analytics.manage or super_admin is cross-tenant staff", () => {
    expect(t.isStaff({ id: "u", roles: ["super_admin"] })).toBe(true);
    expect(t.isStaff({ id: "u", permissions: ["analytics.manage"] })).toBe(true);
    expect(t.isStaff({ id: "u", roles: ["content_editor"], permissions: ["analytics.read", "ai.execute"] })).toBe(false);
  });
});
