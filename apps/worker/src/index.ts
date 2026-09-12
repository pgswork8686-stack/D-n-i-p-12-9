import { Worker } from "bullmq";
import * as dotenv from "dotenv";
import { processSystemJob } from "./processor";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const url = new URL(redisUrl);

console.log(
  JSON.stringify({
    level: "info",
    service: "worker",
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
      message: "BullMQ worker is ready and listening on 'system' queue",
    }),
  );
});

worker.on("error", (err) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "worker",
      message: "BullMQ worker error",
      error: err.message,
    }),
  );
});

const gracefulShutdown = async (signal: string) => {
  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      message: `Received ${signal}. Gracefully closing worker...`,
    }),
  );
  await worker.close();
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
