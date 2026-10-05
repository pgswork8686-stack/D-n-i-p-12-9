import * as crypto from "crypto";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { prisma, Prisma } from "@nexus/database";
import { FORBIDDEN_CLIENT_KPI_FIELDS } from "@nexus/utils";
import type { AnalyticsIngestResponse } from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import { AnalyticsIngestDto, RECORD_DTO_BY_KIND } from "./analytics-ingest.dto";

const MIN_DATE = "2020-01-01";
const MAX_DATE = "2035-12-31";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`)
    .join(",")}}`;
}

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const big = (n: number | undefined) => BigInt(Math.trunc(n ?? 0));

/**
 * Phase 19 — analytics ingestion: raw batch → validate → normalize → analytics facts.
 *
 * Runs in ONE transaction: idempotency check, tenant check, dimension upserts, fact upserts,
 * raw batch row and audit log. Connectors send base measures only; any derived KPI field
 * (ctr, cpc, roas, ...) is rejected because KPIs are always computed server-side.
 * Re-sending a batch with the same (source, idempotencyKey) and identical payload returns the
 * original result; the same key with a different payload is a 409.
 */
@Injectable()
export class AnalyticsIngestService {
  constructor(private readonly audit: AuditService) {}

  validateRecords(dto: AnalyticsIngestDto): Record<string, any>[] {
    const forbidden = new Set(FORBIDDEN_CLIENT_KPI_FIELDS.map((f) => f.toLowerCase()));
    const RecordDto = RECORD_DTO_BY_KIND[dto.kind];
    const errors: string[] = [];
    const out: Record<string, any>[] = [];
    const today = new Date();
    today.setUTCDate(today.getUTCDate() + 1);
    const maxAllowed = today.toISOString().slice(0, 10);
    const seen = new Set<string>();

    dto.records.forEach((raw, i) => {
      if (errors.length >= 20) return;
      const kpi = Object.keys(raw).find((k) => forbidden.has(k.toLowerCase()));
      if (kpi) {
        errors.push(`records[${i}].${kpi}: chỉ số dẫn xuất không được gửi từ connector (backend tự tính)`);
        return;
      }
      const inst = plainToInstance(RecordDto as any, raw) as Record<string, any>;
      const v = validateSync(inst, { whitelist: true, forbidNonWhitelisted: true });
      if (v.length) {
        errors.push(...v.slice(0, 3).map((e) => `records[${i}].${e.property}: ${Object.values(e.constraints || { invalid: "không hợp lệ" })[0]}`));
        return;
      }
      if (!isRealDate(inst.date) || inst.date < MIN_DATE || inst.date > MAX_DATE || inst.date > maxAllowed) {
        errors.push(`records[${i}].date: ngày không hợp lệ hoặc ngoài phạm vi`);
        return;
      }
      if (inst.qualifiedLeads !== undefined && inst.leads !== undefined && inst.qualifiedLeads > inst.leads) {
        errors.push(`records[${i}].qualifiedLeads: không được lớn hơn leads`);
        return;
      }
      if (inst.clicks !== undefined && inst.impressions !== undefined && dto.kind !== "SEO_DAILY" && inst.clicks > inst.impressions && inst.impressions > 0) {
        errors.push(`records[${i}].clicks: không được lớn hơn impressions`);
        return;
      }
      const key = [inst.date, inst.channel ?? "", inst.campaignId ?? inst.productId ?? inst.page ?? "", inst.query ?? ""].join("|");
      if (seen.has(key)) {
        errors.push(`records[${i}]: bản ghi trùng trong cùng lô`);
        return;
      }
      seen.add(key);
      out.push(inst);
    });
    if (errors.length) {
      // The global exception filter returns only `message`, so the first problems go into it.
      throw new BadRequestException({ message: `Payload analytics không hợp lệ: ${errors.slice(0, 5).join("; ")}`, errors });
    }
    return out;
  }

  async ingest(dto: AnalyticsIngestDto, requestId: string): Promise<AnalyticsIngestResponse> {
    const payloadHash = crypto.createHash("sha256").update(stableStringify(dto)).digest("hex");

    const existing = await prisma.analyticsIngestBatch.findUnique({ where: { source_idempotencyKey: { source: dto.source, idempotencyKey: dto.idempotencyKey } } });
    if (existing) return this.replay(existing, payloadHash);

    const records = this.validateRecords(dto);
    const channels = new Set((await prisma.dimChannel.findMany({ select: { key: true } })).map((c) => c.key));
    const unknown = records.find((r) => r.channel !== undefined && !channels.has(r.channel));
    if (unknown) throw new BadRequestException(`Kênh "${unknown.channel}" không có trong analytics.dim_channel`);

    try {
      return await prisma.$transaction(
        async (tx) => {
          const tenant = await tx.tenant.findUnique({ where: { id: dto.clientId } });
          if (!tenant || tenant.type !== "CLIENT" || tenant.status !== "ACTIVE") {
            throw new BadRequestException("clientId không phải tenant CLIENT đang hoạt động");
          }
          const currency = dto.currency ?? tenant.defaultCurrency;
          await tx.dimClient.upsert({
            where: { clientId: tenant.id },
            update: { name: tenant.name, currency: tenant.defaultCurrency, timezone: tenant.timezone, organizationId: tenant.parentId },
            create: { clientId: tenant.id, name: tenant.name, currency: tenant.defaultCurrency, timezone: tenant.timezone, organizationId: tenant.parentId },
          });

          const batch = await tx.analyticsIngestBatch.create({
            data: {
              clientId: tenant.id,
              source: dto.source,
              idempotencyKey: dto.idempotencyKey,
              kind: dto.kind,
              eventTimestamp: new Date(dto.eventTimestamp),
              payloadHash,
              payload: dto as unknown as Prisma.InputJsonValue,
              recordCount: records.length,
              status: "NORMALIZED",
              requestId,
              normalizedAt: new Date(),
            },
          });

          for (const r of records) await this.upsertFact(tx, dto.kind, tenant.id, currency, batch.id, r);

          await this.audit.logActionWithClient(tx, {
            action: "ANALYTICS_BATCH_INGESTED",
            entity: "AnalyticsIngestBatch",
            entityId: batch.id,
            actorId: null as any,
            details: { source: dto.source, clientId: tenant.id, kind: dto.kind, recordCount: records.length, requestId },
          });
          return { batchId: batch.id, status: "NORMALIZED" as const, duplicate: false, recordCount: records.length };
        },
        { timeout: 30_000 },
      );
    } catch (err: any) {
      if (err?.code === "P2002") {
        const raced = await prisma.analyticsIngestBatch.findUnique({ where: { source_idempotencyKey: { source: dto.source, idempotencyKey: dto.idempotencyKey } } });
        if (raced) return this.replay(raced, payloadHash);
      }
      throw err;
    }
  }

  private replay(batch: { id: string; payloadHash: string; recordCount: number }, payloadHash: string): AnalyticsIngestResponse {
    if (batch.payloadHash !== payloadHash) throw new ConflictException("idempotencyKey đã được dùng với payload khác");
    return { batchId: batch.id, status: "NORMALIZED", duplicate: true, recordCount: batch.recordCount };
  }

  private async upsertFact(tx: Prisma.TransactionClient, kind: AnalyticsIngestDto["kind"], clientId: string, currency: string, batchId: string, r: Record<string, any>) {
    const date = asDate(r.date);
    if (kind === "MARKETING_DAILY") {
      const campaignKey = r.campaignId ? String(r.campaignId) : "_all";
      if (r.campaignId) {
        await tx.dimCampaign.upsert({
          where: { clientId_channelKey_externalId: { clientId, channelKey: r.channel, externalId: campaignKey } },
          update: { name: r.campaignName || campaignKey },
          create: { clientId, channelKey: r.channel, externalId: campaignKey, name: r.campaignName || campaignKey },
        });
      }
      const data = {
        currency,
        spendMinor: big(r.spendMinor),
        impressions: big(r.impressions),
        clicks: big(r.clicks),
        sessions: big(r.sessions),
        leads: r.leads ?? 0,
        qualifiedLeads: r.qualifiedLeads ?? 0,
        customers: r.customers ?? 0,
        revenueMinor: big(r.revenueMinor),
        sourceBatchId: batchId,
      };
      await tx.factMarketingDaily.upsert({
        where: { clientId_date_channelKey_campaignKey: { clientId, date, channelKey: r.channel, campaignKey } },
        update: data,
        create: { clientId, date, channelKey: r.channel, campaignKey, ...data },
      });
    } else if (kind === "LEAD_FUNNEL_DAILY") {
      const data = { sessions: big(r.sessions), leads: r.leads, qualifiedLeads: r.qualifiedLeads, opportunities: r.opportunities ?? 0, customers: r.customers, sourceBatchId: batchId };
      await tx.factLeadFunnelDaily.upsert({
        where: { clientId_date_channelKey: { clientId, date, channelKey: r.channel } },
        update: data,
        create: { clientId, date, channelKey: r.channel, ...data },
      });
    } else if (kind === "REVENUE_DAILY") {
      const productKey = r.productId ? String(r.productId) : "_all";
      if (r.productId) {
        await tx.dimProduct.upsert({
          where: { clientId_externalId: { clientId, externalId: productKey } },
          update: { name: r.productName || productKey },
          create: { clientId, externalId: productKey, name: r.productName || productKey },
        });
      }
      const data = { currency, orders: r.orders, revenueMinor: big(r.revenueMinor), refundsMinor: big(r.refundsMinor), sourceBatchId: batchId };
      await tx.factRevenueDaily.upsert({
        where: { clientId_date_channelKey_productKey: { clientId, date, channelKey: r.channel, productKey } },
        update: data,
        create: { clientId, date, channelKey: r.channel, productKey, ...data },
      });
    } else {
      const queryKey = r.query ? String(r.query) : "_all";
      // Store position * impressions so averages stay correct when summed across rows.
      const data = { impressions: big(r.impressions), clicks: big(r.clicks), positionSum: r.averagePosition * r.impressions, sessions: big(r.sessions), sourceBatchId: batchId };
      await tx.factSeoDaily.upsert({
        where: { clientId_date_pageKey_queryKey: { clientId, date, pageKey: r.page, queryKey } },
        update: data,
        create: { clientId, date, pageKey: r.page, queryKey, ...data },
      });
    }
  }
}
