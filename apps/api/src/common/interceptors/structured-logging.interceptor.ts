import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { CORRELATION_ID_HEADER } from "../middleware/correlation-id.middleware";
import { formatStructuredLog, redactSensitiveFields } from "@nexus/utils";

@Injectable()
export class StructuredLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const startTime = Date.now();
    const correlationId =
      req.correlationId ||
      (req.headers[CORRELATION_ID_HEADER] as string) ||
      "unknown";

    const { method, originalUrl, ip } = req;
    const userAgent = req.get("user-agent") || "";
    const user = (req as any).user;

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startTime;
          const statusCode = res.statusCode;

          const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

          const logMessage = formatStructuredLog({
            timestamp: new Date().toISOString(),
            level,
            correlationId,
            service: "api",
            method,
            path: originalUrl,
            statusCode,
            durationMs,
            userId: user?.id,
            ip: Array.isArray(ip) ? ip[0] : ip,
            userAgent,
            message: `${method} ${originalUrl} ${statusCode} - ${durationMs}ms`,
            details: {
              query: redactSensitiveFields(req.query),
              params: redactSensitiveFields(req.params),
            },
          });

          if (level === "error") {
            this.logger.error(logMessage);
          } else if (level === "warn") {
            this.logger.warn(logMessage);
          } else {
            this.logger.log(logMessage);
          }
        },
      }),
    );
  }
}
