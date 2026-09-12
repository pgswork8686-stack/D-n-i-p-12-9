import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { CORRELATION_ID_HEADER } from "../middleware/correlation-id.middleware";

function sanitizeSecretStrings(text: string): string {
  if (!text) return "";
  return text
    .replace(/(postgres|redis|s3|https?):\/\/[^\s@]+@/gi, "$1://***:***@")
    .replace(/(key|secret|password|token|auth)=([^\s&]+)/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId =
      request.correlationId ||
      (request.headers[CORRELATION_ID_HEADER] as string) ||
      "unknown";

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let clientMessage = "Internal server error";

    // For 4xx HttpExceptions, expose client-safe messages
    if (isHttpException && status < 500) {
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === "string") {
        clientMessage = exceptionResponse;
      } else if (
        typeof exceptionResponse === "object" &&
        exceptionResponse !== null &&
        "message" in exceptionResponse
      ) {
        const msg = (exceptionResponse as Record<string, unknown>).message;
        clientMessage = Array.isArray(msg) ? msg.join(", ") : String(msg);
      }
    }
    // For 500 / non-HttpExceptions, client ALWAYS receives "Internal server error"

    // Sanitize log information for backend diagnostics
    const rawErrorMessage =
      exception instanceof Error ? exception.message : String(exception);
    const sanitizedLogMessage = sanitizeSecretStrings(rawErrorMessage);

    const isProd = process.env.NODE_ENV === "production";
    const stack =
      !isProd && exception instanceof Error
        ? sanitizeSecretStrings(exception.stack || "")
        : undefined;

    this.logger.error(
      JSON.stringify({
        level: "error",
        correlationId,
        method: request.method,
        url: request.url,
        statusCode: status,
        message: sanitizedLogMessage,
      }),
      stack,
    );

    response.status(status).json({
      status: "error",
      statusCode: status,
      message: clientMessage,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
