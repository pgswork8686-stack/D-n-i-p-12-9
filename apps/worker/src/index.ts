import { Worker } from "bullmq";
import * as dotenv from "dotenv";
import * as path from "path";
import { prisma } from "@nexus/database";
import { processSystemJob } from "./processor";
import { processOutboxEvents } from "./outbox-processor";
import { expireDueEntitlements } from "./entitlement-issuer";
import { reconcileExternalAllocations } from "./allocation-reconciler";
import {
  provisionInternalLicenses,
  reconcileInternalLicenses,
} from "./license-provisioner";


// Load root .env file
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const workerId =
  process.env.WORKER_ID ||
  `worker-${process.pid}-${Math.random().toString(36).substring(2, 8)}`;

const pollIntervalMs = Math.max(
  250,
  Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 1000,
);

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const url = new URL(redisUrl);

console.log(
  JSON.stringify({
    level: "info",
    service: "worker",
    workerId,
    pollIntervalMs,
    message: `Starting BullMQ system worker connecting to ${url.hostname}:${url.port || 6379}...`,
  }),
);

const worker = new Worker(
  "system",
  async (job) => {
    return processSystemJob(job);
  },
  {
    connection: {
      host: url.hostname || "localhost",
      port: Number(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    },
    concurrency: 5,
  },
);

worker.on("ready", () => {
  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      workerId,
      message: "BullMQ worker is ready and listening on 'system' queue",
    }),
  );
});

worker.on("error", (err) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "worker",
      workerId,
      message: "BullMQ worker error",
      error: err.message,
    }),
  );
});

// Runtime polling loop for outbox processing and entitlement expiration
let isPolling = false;
let isShuttingDown = false;

const runPollingTick = async () => {
  if (isPolling || isShuttingDown) return;
  isPolling = true;
  try {
    // 1. Process pending outbox events (ORDER_PAID -> issue entitlements)
    await processOutboxEvents({ workerId });

    // 2. Authoritative expiration of active entitlements whose expiresAt <= NOW()
    await expireDueEntitlements({ workerId });

    // 3. Authoritative reconciliation of external allocations whose parent entitlement is REVOKED or EXPIRED
    await reconcileExternalAllocations({ workerId });

    // 4. Authoritative provisioning of internal licenses for active INTERNAL_LICENSE entitlements
    await provisionInternalLicenses({ workerId });

    // 5. Authoritative reconciliation of internal licenses whose parent entitlement is REVOKED or EXPIRED
    await reconcileInternalLicenses({ workerId });
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        workerId,
        message: "Worker polling tick error",
        error: err?.message || String(err),
      }),
    );
  } finally {
    isPolling = false;
  }
};

const pollTimer = setInterval(runPollingTick, pollIntervalMs);
// Trigger initial tick immediately
runPollingTick().catch(() => {});

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearInterval(pollTimer);

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      workerId,
      message: `Received ${signal}. Gracefully closing worker...`,
    }),
  );

  const startWait = Date.now();
  while (isPolling && Date.now() - startWait < 5000) {
    await new Promise((res) => setTimeout(res, 100));
  }

  try {
    await worker.close();
  } catch {
    // ignore
  }

  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }

  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
