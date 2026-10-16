import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";

/**
 * Lets anonymous requests through while still identifying signed-in users.
 * A request that presents a token must present a valid one: an invalid or
 * expired token is rejected (401) instead of being silently downgraded.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authGuard: AuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.headers["authorization"]) {
      return true;
    }
    return this.authGuard.canActivate(context);
  }
}
