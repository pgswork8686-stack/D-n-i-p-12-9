import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import * as crypto from "crypto";
import {
  DOWNLOAD_RATE_LIMIT_MAX,
  DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS,
} from "@nexus/contracts";

const SLIDING_WINDOW_LUA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local member = ARGV[4]

local clearBefore = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)
local currentCount = redis.call('ZCARD', key)

if currentCount >= maxRequests then
  return {0, currentCount}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, currentCount + 1}
`;

@Injectable()
export class DownloadRateLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(DownloadRateLimiter.name);
  private redisClient: Redis;
  private readonly defaultLimit: number;
  private readonly defaultWindowSeconds: number;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>(
      "REDIS_URL",
      "redis://localhost:6379",
    );
    this.defaultLimit = Number(
      this.configService.get<string>(
        "DOWNLOAD_RATE_LIMIT_MAX",
        String(DOWNLOAD_RATE_LIMIT_MAX),
      ),
    );
    this.defaultWindowSeconds = Number(
      this.configService.get<string>(
        "DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS",
        String(DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS),
      ),
    );

    this.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
    });
  }

  /**
   * Evaluates atomic sliding-window rate limit for customer download request.
   * Key: ratelimit:download:customer:${entitlementId}:${userId}
   * Fails closed (503) if Redis is unavailable.
   */
  async checkAndConsumeCustomerRateLimit(
    userId: string,
    entitlementId: string,
    customLimit?: number,
    customWindow?: number,
  ): Promise<void> {
    const key = `ratelimit:download:customer:${entitlementId}:${userId}`;
    await this.evaluateSlidingWindow(key, customLimit, customWindow);
  }

  /**
   * Evaluates atomic sliding-window rate limit for software updater requests.
   * Key: ratelimit:download:updater:${entitlementId}:${normalizedDomain}
   * Fails closed (503) if Redis is unavailable.
   */
  async checkAndConsumeUpdaterRateLimit(
    entitlementId: string,
    normalizedDomain: string,
    customLimit?: number,
    customWindow?: number,
  ): Promise<void> {
    const key = `ratelimit:download:updater:${entitlementId}:${normalizedDomain}`;
    await this.evaluateSlidingWindow(key, customLimit, customWindow);
  }

  /**
   * Generic backwards-compatible customer download rate limit check.
   */
  async checkAndConsumeRateLimit(
    userId: string,
    entitlementId: string,
    customLimit?: number,
    customWindow?: number,
  ): Promise<void> {
    await this.checkAndConsumeCustomerRateLimit(
      userId,
      entitlementId,
      customLimit,
      customWindow,
    );
  }

  private async evaluateSlidingWindow(
    key: string,
    customLimit?: number,
    customWindowSeconds?: number,
  ): Promise<void> {
    const limit = customLimit ?? this.defaultLimit;
    const windowSeconds = customWindowSeconds ?? this.defaultWindowSeconds;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();
    const member = `${now}-${crypto.randomUUID()}`;

    try {
      const result = (await this.redisClient.eval(
        SLIDING_WINDOW_LUA_SCRIPT,
        1,
        key,
        now,
        windowMs,
        limit,
        member,
      )) as [number, number];

      const [allowed, current] = result;
      if (allowed === 0) {
        this.logger.warn(
          `[RateLimit] Download limit exceeded for key=${key}. Current=${current}, limit=${limit}`,
        );
        throw new HttpException(
          "Too many download requests. Rate limit exceeded, please try again later.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(
        `[RateLimit] Redis rate limit authority unavailable for key=${key}: ${err?.message || err}`,
      );
      // Invariant: fail closed for signed URL issuance with safe 503
      throw new HttpException(
        "Rate limit service unavailable. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.redisClient.quit();
    } catch {
      // Ignored
    }
  }
}
