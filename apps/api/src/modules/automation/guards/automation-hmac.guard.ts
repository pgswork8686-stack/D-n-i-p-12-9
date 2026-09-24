import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import {
  verifyAutomationSignature,
  claimAutomationReplayKey,
  resolveAutomationServiceSecret,
} from "@nexus/utils";

@Injectable()
export class AutomationHmacGuard implements CanActivate, OnModuleDestroy {
  private redisClient?: Redis;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() redisClient?: Redis,
  ) {
    if (redisClient) {
      this.redisClient = redisClient;
    } else {
      const redisUrl =
        this.configService?.get<string>("REDIS_URL") ||
        process.env.REDIS_URL ||
        "redis://localhost:6379";
      this.redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      });
    }
  }

  private getRedis(): Redis {
    if (!this.redisClient) {
      const redisUrl =
        this.configService?.get<string>("REDIS_URL") ||
        process.env.REDIS_URL ||
        "redis://localhost:6379";
      this.redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      });
    }
    return this.redisClient;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // ignore disconnect errors
      }
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const serviceName =
      req.headers["x-nexus-service"] || req.headers["x-service-name"];
    const timestamp = req.headers["x-nexus-timestamp"];
    const requestId = req.headers["x-nexus-request-id"];
    const signature = req.headers["x-nexus-signature"];

    if (!serviceName) {
      throw new UnauthorizedException("Missing X-Nexus-Service header");
    }

    if (serviceName !== "n8n") {
      throw new UnauthorizedException("Invalid service identity: expected n8n");
    }

    if (!timestamp) {
      throw new UnauthorizedException("Missing X-Nexus-Timestamp header");
    }

    if (!requestId) {
      throw new UnauthorizedException("Missing X-Nexus-Request-Id header");
    }

    if (!signature) {
      throw new UnauthorizedException("Missing X-Nexus-Signature header");
    }

    let secret: string;
    try {
      secret = resolveAutomationServiceSecret();
    } catch (secErr: any) {
      throw new UnauthorizedException(
        "Insecure automation service secret configured in production",
      );
    }

    if (!secret || secret === "") {
      throw new UnauthorizedException(
        "Automation service authentication unconfigured",
      );
    }

    // Canonical path: use originalUrl without query string
    const url = (req.originalUrl || req.url || "").split("?")[0];

    const result = verifyAutomationSignature({
      service: serviceName,
      method: req.method,
      path: url,
      timestamp,
      requestId,
      body: req.body,
      secret,
      signature,
      maxSkewMs: 5 * 60 * 1000, // 5 minutes
    });

    if (!result.valid) {
      throw new UnauthorizedException(
        `Invalid automation signature: ${result.reason || "Verification failed"}`,
      );
    }

    // Distributed replay protection via Redis (shared helper):
    // Atomic SET NX PX 600000 key: automation:hmac:replay:<service>:<requestId>
    // Fail-closed 503 if Redis is down, 409 if duplicate requestId.
    try {
      const redis = this.getRedis();
      const claim = await claimAutomationReplayKey(redis, serviceName, requestId);
      if (claim.outcome === "duplicate") {
        throw new ConflictException(
          "Replay attack detected: duplicate request ID",
        );
      }
    } catch (err: any) {
      if (err instanceof ConflictException) {
        throw err;
      }
      throw new ServiceUnavailableException(
        "Redis replay protection unavailable",
      );
    }

    // Attach verified service info to request
    req.automationService = {
      name: serviceName,
      requestId,
      verifiedAt: new Date(),
    };

    return true;
  }
}
