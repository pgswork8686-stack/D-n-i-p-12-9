import { Body, Controller, Get, HttpCode, HttpStatus, PayloadTooLargeException, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { AutomationHmacGuard } from "../automation/guards/automation-hmac.guard";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsIngestService } from "./analytics-ingest.service";
import { AnalyticsIngestDto } from "./analytics-ingest.dto";

/** Hard cap independent of the global body parser limit. */
export const MAX_INGEST_BYTES = 256 * 1024;

/**
 * Internal ingestion endpoint for connectors (n8n). Authenticated with the same HMAC scheme as
 * the other internal automation callbacks: X-Nexus-Service / Timestamp / Request-Id / Signature,
 * ±5 min timestamp window and Redis replay protection (duplicate request id → 409).
 */
@Controller(["internal/analytics", "v1/internal/analytics"])
@UseGuards(AutomationHmacGuard)
export class InternalAnalyticsController {
  constructor(private readonly ingest: AnalyticsIngestService) {}

  @Post("ingest")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async ingestBatch(@Req() req: any, @Body() dto: AnalyticsIngestDto) {
    const length = Number(req.headers["content-length"] || 0);
    if (length > MAX_INGEST_BYTES) throw new PayloadTooLargeException("Payload vượt quá 256 KB");
    return this.ingest.ingest(dto, String(req.automationService?.requestId || req.headers["x-nexus-request-id"]));
  }
}

/** Read API. `analytics.read` plus tenant membership (or `analytics.manage` for staff). */
@Controller(["analytics", "v1/analytics"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("clients")
  @RequirePermissions("analytics.read")
  clients(@Req() req: any) {
    return this.analytics.listClients(req.user);
  }

  @Get("metrics")
  @RequirePermissions("analytics.read")
  metrics() {
    return this.analytics.metricDefinitions();
  }

  @Get("overview")
  @RequirePermissions("analytics.read")
  overview(@Req() req: any, @Query("clientId") clientId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.analytics.overview(req.user, clientId, from, to);
  }

  @Get("campaigns")
  @RequirePermissions("analytics.read")
  campaigns(@Req() req: any, @Query("clientId") clientId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.analytics.campaigns(req.user, clientId, from, to);
  }

  @Get("funnel")
  @RequirePermissions("analytics.read")
  funnel(@Req() req: any, @Query("clientId") clientId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.analytics.funnel(req.user, clientId, from, to);
  }
}
