import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { SystemJobPayload } from "@nexus/contracts";
import { generateCorrelationId } from "@nexus/utils";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private systemQueue: Queue;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>(
      "REDIS_URL",
      "redis://localhost:6379",
    );

    const url = new URL(redisUrl);
    this.systemQueue = new Queue("system", {
      connection: {
        host: url.hostname || "localhost",
        port: Number(url.port) || 6379,
        password: url.password || undefined,
        maxRetriesPerRequest: null,
      },
    });
  }

  async dispatchTestJob(
    type = "ping-job",
    payload?: Record<string, unknown>,
    correlationId?: string,
  ): Promise<{ jobId: string; correlationId: string }> {
    const effectiveCorrelationId = correlationId || generateCorrelationId("job");
    const jobId = `job_${Date.now()}`;

    const data: SystemJobPayload = {
      jobId,
      type,
      correlationId: effectiveCorrelationId,
      timestamp: new Date().toISOString(),
      payload,
    };

    const job = await this.systemQueue.add(type, data, {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(
      `[${effectiveCorrelationId}] Dispatched job to system queue: id=${job.id}, type=${type}`,
    );

    return { jobId: String(job.id), correlationId: effectiveCorrelationId };
  }

  async onModuleDestroy() {
    await this.systemQueue.close();
  }
}
