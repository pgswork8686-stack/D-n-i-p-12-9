import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { verifyAutomationSignature } from "@nexus/utils";

// In-memory cache for replay protection: tracks request IDs with expiry timestamps
const seenRequestIds = new Map<string, number>();

// Periodic cleanup of expired request IDs (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000;
  for (const [reqId, ts] of seenRequestIds.entries()) {
    if (now - ts > maxAge) {
      seenRequestIds.delete(reqId);
    }
  }
}, 60 * 1000).unref();

@Injectable()
export class AutomationHmacGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const serviceName =
      req.headers["x-nexus-service"] || req.headers["x-service-name"];
    const timestamp = req.headers["x-nexus-timestamp"];
    const requestId = req.headers["x-nexus-request-id"];
    const signature = req.headers["x-nexus-signature"];

    if (!serviceName) {
      throw new UnauthorizedException("Missing X-Nexus-Service header");
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

    // Replay attack prevention: duplicate request IDs within skew window are strictly rejected
    if (seenRequestIds.has(requestId)) {
      throw new ConflictException(
        "Replay attack detected: duplicate request ID",
      );
    }

    const secret = process.env.AUTOMATION_SERVICE_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (!secret || secret.trim() === "") {
      throw new UnauthorizedException(
        "Automation service authentication unconfigured",
      );
    }

    if (isProduction) {
      const lower = secret.toLowerCase();
      if (
        lower === "placeholder" ||
        lower === "changeme" ||
        lower === "secret" ||
        lower.includes("placeholder")
      ) {
        throw new UnauthorizedException(
          "Insecure automation service secret configured in production",
        );
      }
    }

    // Canonical path: use originalUrl without query string
    const url = (req.originalUrl || req.url || "").split("?")[0];

    const result = verifyAutomationSignature({
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

    // Record request ID to prevent replays
    seenRequestIds.set(requestId, Date.now());

    // Attach verified service info to request
    req.automationService = {
      name: serviceName,
      requestId,
      verifiedAt: new Date(),
    };

    return true;
  }
}
