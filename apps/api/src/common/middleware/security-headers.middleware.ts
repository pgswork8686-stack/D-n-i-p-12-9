import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { getDefaultSecurityHeaders } from "@nexus/utils";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const headers = getDefaultSecurityHeaders();
    for (const [header, value] of Object.entries(headers)) {
      res.setHeader(header, value);
    }

    // Explicitly prohibit frame embedding across all API responses
    res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none';");

    next();
  }
}
