import { Injectable, Logger } from "@nestjs/common";
import { prisma, Prisma } from "@nexus/database";

export interface LogActionParams {
  action: string;
  entity: string;
  entityId?: string | null;
  actorId?: string | null;
  details?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Helper to sanitize database error messages by redacting connection strings,
 * credentials, and secret parameters.
 */
export function sanitizeAuditErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";

  // If Prisma error with error code, return safe generic code without raw query details
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    return `Database operation failed [code: ${code || "UNKNOWN"}]`;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  return rawMessage
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgresql://[REDACTED_URI]")
    .replace(/(password\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s,;&]+/gi, "$1[REDACTED]");
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /**
   * Record audit log atomically using a provided Prisma transaction client.
   * Throws on error so the surrounding transaction will roll back if audit fails.
   */
  async logActionWithClient(
    tx: Prisma.TransactionClient,
    params: LogActionParams,
  ): Promise<void> {
    const sanitizedDetails = params.details
      ? this.sanitizeDetails(params.details)
      : undefined;

    await tx.auditLog.create({
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
  }

  /**
   * Standalone audit logging (uses default prisma client).
   * Catches errors and logs only sanitized messages (does not dump raw error objects / stacks).
   */
  async logAction(params: LogActionParams): Promise<void> {
    try {
      await this.logActionWithClient(prisma, params);
    } catch (error) {
      // M03: Sanitize error logging - do not dump raw error object or stack traces
      // that could contain sensitive connection strings or credentials
      const safeMessage = sanitizeAuditErrorMessage(error);
      this.logger.error(`Failed to record audit log: ${safeMessage}`);
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