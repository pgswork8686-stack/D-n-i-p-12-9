import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { QueueService } from "./queue.service";

const ALLOWED_JOB_TYPES = new Set(["system-ping", "health-check", "test-ping"]);

@Controller("queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post("test-job")
  @UseGuards(AuthGuard)
  async dispatchTestJob(
    @Req() req: Request,
    @Body() body?: { type?: string; payload?: Record<string, unknown> },
  ) {
    // Development-only protection
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException(
        "Queue test endpoint is strictly disabled in production",
      );
    }

    const type = body?.type || "test-ping";
    if (!ALLOWED_JOB_TYPES.has(type)) {
      throw new BadRequestException(
        `Invalid job type '${type}'. Allowed types: ${Array.from(ALLOWED_JOB_TYPES).join(", ")}`,
      );
    }

    const payload = body?.payload || { message: "Health test ping job" };
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Payload must be a valid JSON object");
    }

    if (JSON.stringify(payload).length > 2048) {
      throw new BadRequestException(
        "Payload exceeds maximum allowed size of 2KB",
      );
    }

    const correlationId = req.correlationId;
    const result = await this.queueService.dispatchTestJob(
      type,
      payload,
      correlationId,
    );

    return {
      status: "enqueued",
      ...result,
    };
  }
}
