import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@nexus/database";

export interface LogActionParams {
  action: string;
  entity: string;
  entityId?: string | null;
  actorId?: string | null;
  details?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async logAction(params: LogActionParams): Promise<void> {
    try {
      const sanitizedDetails = params.details
        ? this.sanitizeDetails(params.details)
        : undefined;

      await prisma.auditLog.create({
        data: {
          action: params.action,
          entity: params.entity,
          entityId: params.entityId || null,
          actorId: params.actorId || null,
          details: sanitizedDetails,
          ipAddress: params.ipAddress || null,
          userAgent: params.userAgent || null,
        },
      });

      this.logger.log(
        JSON.stringify({
          level: "info",
          service: "api-audit",
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          actorId: params.actorId,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (error) {
      this.logger.error("Failed to record audit log", error);
    }
  }

  private sanitizeDetails(details: Record<string, any>): Record<string, any> {
    const sensitiveKeys = [
      "password",
      "token",
      "accesstoken",
      "refreshtoken",
      "authorization",
      "secret",
      "servicerolekey",
      "apikey",
    ];

    const copy = { ...details };
    for (const key of Object.keys(copy)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        copy[key] = "[REDACTED]";
      } else if (typeof copy[key] === "object" && copy[key] !== null) {
        copy[key] = this.sanitizeDetails(copy[key]);
      }
    }
    return copy;
  }
}