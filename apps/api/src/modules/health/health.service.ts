import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { prisma } from "@nexus/database";
import {
  HealthCheckResponse,
  DependencyHealth,
} from "@nexus/contracts";
import {
  IStorageService,
  STORAGE_SERVICE,
} from "../storage/storage.interface";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private redisClient?: Redis;

  constructor(
    private configService: ConfigService,
    @Inject(STORAGE_SERVICE) private storageService: IStorageService,
  ) {
    const redisUrl = this.configService.get<string>(
      "REDIS_URL",
      "redis://localhost:6379",
    );
    try {
      this.redisClient = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
      });
    } catch (err) {
      this.logger.error("Failed to initialize Redis client", err);
    }
  }

  async checkDatabase(): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1;`;
      return {
        status: "ok",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Database check failed";
      this.logger.warn(`Database health check failed: ${errorMsg}`);
      return {
        status: "error",
        latencyMs: Date.now() - start,
        message: "Database unreachable",
      };
    }
  }

  async checkRedis(): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      if (!this.redisClient) {
        return { status: "error", message: "Redis client not initialized" };
      }
      if (this.redisClient.status !== "ready") {
        await this.redisClient.connect();
      }
      const pong = await this.redisClient.ping();
      if (pong === "PONG") {
        return {
          status: "ok",
          latencyMs: Date.now() - start,
        };
      }
      return {
        status: "error",
        latencyMs: Date.now() - start,
        message: "Invalid ping response",
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Redis check failed";
      this.logger.warn(`Redis health check failed: ${errorMsg}`);
      return {
        status: "error",
        latencyMs: Date.now() - start,
        message: "Redis unreachable",
      };
    }
  }

  async checkStorage(): Promise<DependencyHealth> {
    const res = await this.storageService.isHealthy();
    return {
      status: res.status,
      latencyMs: res.latencyMs,
      message: res.message ? "Storage unreachable" : undefined,
    };
  }

  async checkAggregate(): Promise<HealthCheckResponse> {
    const [dbHealth, redisHealth, storageHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
    ]);

    const isAllOk =
      dbHealth.status === "ok" &&
      redisHealth.status === "ok" &&
      storageHealth.status === "ok";

    return {
      status: isAllOk ? "ok" : "error",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbHealth,
        redis: redisHealth,
        storage: storageHealth,
      },
    };
  }
}
