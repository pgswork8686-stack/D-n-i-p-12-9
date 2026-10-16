import { CanActivate, ExecutionContext, PayloadTooLargeException, Type, mixin } from "@nestjs/common";

/**
 * Rejects a request whose declared `Content-Length` exceeds `maxBytes` with 413, before any
 * interceptor (Multer) starts reading the body.
 *
 * This is one layer of three, none of which replaces the others:
 *  1. Edge: Caddy `request_body max_size` per path (infra/docker/Caddyfile) stops the bytes
 *     from reaching the API at all.
 *  2. This guard: cheap, per-endpoint, still correct if the API is ever reached without Caddy.
 *  3. Multer `limits`: bounds what is actually buffered when the header is missing or lies
 *     (chunked uploads), so memory stays bounded regardless of the header.
 *
 * A missing or non-numeric header is allowed through to layer 3 rather than guessed at.
 */
export function maxRequestBytes(maxBytes: number): Type<CanActivate> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxRequestBytes requires a positive integer");
  }
  class MaxRequestBytesGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
      const header = req.headers["content-length"];
      const raw = Array.isArray(header) ? header[0] : header;
      if (raw === undefined || !/^\d+$/.test(raw)) return true;
      if (Number(raw) > maxBytes) {
        throw new PayloadTooLargeException(`Request body exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit for this endpoint.`);
      }
      return true;
    }
  }
  return mixin(MaxRequestBytesGuard);
}
