import { Controller, Post, Body, Req } from "@nestjs/common";
import { Request } from "express";
import { QueueService } from "./queue.service";

@Controller("queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post("test-job")
  async dispatchTestJob(
    @Req() req: Request,
    @Body() body?: { type?: string; payload?: Record<string, unknown> },
  ) {
    const correlationId = req.correlationId;
    const result = await this.queueService.dispatchTestJob(
      body?.type || "test-ping",
      body?.payload || { message: "Health test ping job" },
      correlationId,
    );
    return {
      status: "enqueued",
      ...result,
    };
  }
}
