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

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = "Internal server error";
    if (typeof exceptionResponse === "string") {
      message = exceptionResponse;
    } else if (
      typeof exceptionResponse === "object" &&
      exceptionResponse !== null &&
      "message" in exceptionResponse
    ) {
      message = String((exceptionResponse as Record<string, unknown>).message);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Never log or leak internal database credentials or sensitive connection strings
    const sanitizedMessage = message.replace(/(postgres|redis):\/\/[^@]+@/gi, "$1://***:***@");

    this.logger.error(
      `[${correlationId}] ${request.method} ${request.url} failed: ${sanitizedMessage}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      status: "error",
      statusCode: status,
      message: sanitizedMessage,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
