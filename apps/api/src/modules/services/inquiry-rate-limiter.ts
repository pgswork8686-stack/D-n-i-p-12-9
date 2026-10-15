import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import * as crypto from "crypto";

// Same atomic sliding window as the download limiter (Redis server time, one ZSET per key).
const SLIDING_WINDOW_LUA_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local maxRequests = tonumber(ARGV[2])
local nonce = ARGV[3]

local t = redis.call('TIME')
local nowMs = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local member = tostring(nowMs) .. ':' .. nonce

redis.call('ZREMRANGEBYSCORE', key, '-inf', nowMs - windowMs)
local currentCount = redis.call('ZCARD', key)

if currentCount >= maxRequests then
  return {0, currentCount}
end

redis.call('ZADD', key, nowMs, member)
redis.call('PEXPIRE', key, windowMs)
return {1, currentCount + 1}
`;

export interface RateLimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Rate limits the public inquiry form per client IP and per contact email.
 * Fails closed (503) when Redis is unavailable so the public form cannot be
 * flooded while the limiter is down.
 */
@Injectable()
export class InquiryRateLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(InquiryRateLimiter.name);
  private readonly redis: Redis;
  readonly perIpLimit: number;
  readonly perEmailLimit: number;
  readonly windowSeconds: number;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.get<string>("REDIS_URL", "redis://localhost:6379"), {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.perIpLimit = Number(config.get<string>("SERVICE_INQUIRY_RATE_LIMIT_PER_IP", "5"));
    this.perEmailLimit = Number(config.get<string>("SERVICE_INQUIRY_RATE_LIMIT_PER_EMAIL", "3"));
    this.windowSeconds = Number(config.get<string>("SERVICE_INQUIRY_RATE_LIMIT_WINDOW_SECONDS", "3600"));
  }

  async consumeForSubmission(ipHash: string, email: string): Promise<void> {
    const emailHash = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
    await this.consume({ key: `ratelimit:service-inquiry:ip:${ipHash}`, limit: this.perIpLimit, windowSeconds: this.windowSeconds });
    await this.consume({ key: `ratelimit:service-inquiry:email:${emailHash}`, limit: this.perEmailLimit, windowSeconds: this.windowSeconds });
  }

  async consume(rule: RateLimitRule): Promise<void> {
    let result: [number, number];
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      result = (await this.redis.eval(
        SLIDING_WINDOW_LUA_SCRIPT,
        1,
        rule.key,
        rule.windowSeconds * 1000,
        rule.limit,
        crypto.randomUUID(),
      )) as [number, number];
    } catch (err: any) {
      this.logger.error(`[RateLimit] Redis unavailable for inquiry limiter: ${err?.message || err}`);
      throw new HttpException(
        "Hệ thống tạm thời không nhận yêu cầu. Vui lòng thử lại sau.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (result[0] === 0) {
      throw new HttpException(
        "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      // Ignored
    }
  }
}
