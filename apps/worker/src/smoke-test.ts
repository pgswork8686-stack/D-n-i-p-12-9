import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import * as dotenv from "dotenv";
import * as path from "path";
import { generateCorrelationId } from "@nexus/utils";
import { SystemJobPayload } from "@nexus/contracts";
import { processSystemJob } from "./processor";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const url = new URL(redisUrl);

async function runSmokeTest() {
  const correlationId = generateCorrelationId("smoke");
  const jobId = `smoke_${Date.now()}`;

  console.log(`\n=== NEXUSTHEME WORKER SMOKE TEST ===`);
  console.log(`Correlation ID: ${correlationId}`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Target Redis: ${url.hostname}:${url.port || 6379}`);

  // Test Redis reachability
  let redisLive = false;
  const probe = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
  });
  probe.on("error", () => {
    // Expected when Redis is offline
  });

  try {
    await probe.connect();
    const pong = await probe.ping();
    if (pong === "PONG") {
      redisLive = true;
    }
  } catch (_err) {
    redisLive = false;
  } finally {
    probe.disconnect();
  }

  if (redisLive) {
    console.log(`✓ Live Redis connection verified. Executing BullMQ end-to-end queue test...`);

    const connection = {
      host: url.hostname || "localhost",
      port: Number(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    };

    const queue = new Queue<SystemJobPayload>("system", { connection });
    let jobFinished = false;

    const worker = new Worker<SystemJobPayload>(
      "system",
      async (job) => {
        return processSystemJob(job);
      },
      { connection },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!jobFinished) reject(new Error("Worker smoke test timed out"));
      }, 10000);

      worker.on("completed", (job, returnvalue) => {
        if (job.id === jobId) {
          jobFinished = true;
          console.log(`\n✓ [Worker Smoke Event] Completed job: ${job.id}`);
          console.log(`  Return Value: ${JSON.stringify(returnvalue)}`);
          clearTimeout(timeout);
          resolve();
        }
      });

      // Enqueue the smoke test job
      queue
        .add(
          "smoke-test-ping",
          {
            jobId,
            type: "smoke-test-ping",
            correlationId,
            timestamp: new Date().toISOString(),
            payload: { reason: "Phase 1 smoke test verification" },
          },
          { jobId },
        )
        .then((job) => {
          console.log(`✓ Enqueued test job: id=${job.id}, correlationId=${correlationId}`);
        })
        .catch(reject);
    });

    await worker.close();
    await queue.close();

    console.log(`\n✓ WORKER SMOKE TEST: PASSED (Live BullMQ Queue Processed)\n`);
  } else {
    console.log(`! Live Redis not reachable (Docker not started). Testing worker processor pipeline directly...`);

    const mockJob = {
      id: jobId,
      name: "smoke-test-ping",
      data: {
        jobId,
        type: "smoke-test-ping",
        correlationId,
        timestamp: new Date().toISOString(),
        payload: { reason: "Phase 1 processor smoke test" },
      },
    } as any;

    const result = await processSystemJob(mockJob);

    if (result.success && result.jobId === jobId) {
      console.log(`\n✓ WORKER SMOKE TEST: PASSED (Processor Pipeline Verified)`);
      console.log(`  Job ID: ${result.jobId}`);
      console.log(`  Correlation ID: ${correlationId}`);
      console.log(`  Processed At: ${result.processedAt}\n`);
    } else {
      throw new Error("Worker processor returned failure result");
    }
  }

  process.exit(0);
}

runSmokeTest().catch((err) => {
  console.error(`\n✗ WORKER SMOKE TEST FAILED:`, err);
  process.exit(1);
});
