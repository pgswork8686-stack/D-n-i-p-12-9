import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { InquiryRateLimiter } from "./inquiry-rate-limiter";

export const UPLOAD_QUOTA_KEY = "services:upload-quota";

export interface UploadQuotaOptions {
  /** Redis key segment, one bucket per scope and user. */
  scope: string;
  /** Environment variable that overrides the hourly limit. */
  limitEnv: string;
  defaultLimit: number;
}

export const UploadQuota = (options: UploadQuotaOptions) => SetMetadata(UPLOAD_QUOTA_KEY, options);

/**
 * Per-account quota for multipart requests, enforced before Multer buffers the
 * body. Rate limits checked inside the handler run after up to 5 x 10 MB has
 * already been read into memory, so they cannot protect against repeated
 * large uploads by a signed-in account. Anonymous file parts are refused by
 * the Multer fileFilter instead. Fails closed (503) like the other limiters.
 */
@Injectable()
export class UploadQuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: InquiryRateLimiter,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const quota = this.reflector.get<UploadQuotaOptions | undefined>(UPLOAD_QUOTA_KEY, context.getHandler());
    const request = context.switchToHttp().getRequest<Request>();
    if (!quota || !request.user) return true;

    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("multipart/")) return true;

    const configured = Number(this.config.get<string>(quota.limitEnv));
    const limit = Number.isFinite(configured) && configured > 0 ? configured : quota.defaultLimit;
    await this.limiter.consume({
      key: `ratelimit:service-upload:${quota.scope}:${request.user.id}`,
      limit,
      windowSeconds: 3600,
    });
    return true;
  }
}
