import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import {
  DOWNLOAD_RATE_LIMIT_MAX,
  DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS,
} from "@nexus/contracts";

const RATE_LIMIT_LUA_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
end

if current > limit then
  return {0, current}
else
  return {1, current}
end
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
   * Evaluates atomic rate limit for customer download request.
   * Throws 429 Too Many Requests if rate limit exceeded.
   * Throws 503 Service Unavailable if Redis is down/unreachable (fails closed).
   */
  async checkAndConsumeRateLimit(
    userId: string,
    entitlementId: string,
    customLimit?: number,
    customWindow?: number,
  ): Promise<void> {
    const limit = customLimit ?? this.defaultLimit;
    const windowSeconds = customWindow ?? this.defaultWindowSeconds;
    const key = `ratelimit:download:${userId}:${entitlementId}`;

    try {
      const result = (await this.redisClient.eval(
        RATE_LIMIT_LUA_SCRIPT,
        1,
        key,
        limit,
        windowSeconds,
      )) as [number, number];

      const [allowed, current] = result;
      if (allowed === 0) {
        this.logger.warn(
          `[RateLimit] Download limit exceeded for user=${userId}, entitlement=${entitlementId}. Current=${current}, limit=${limit}`,
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
        `[RateLimit] Redis rate limit authority unavailable: ${err?.message || err}`,
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
