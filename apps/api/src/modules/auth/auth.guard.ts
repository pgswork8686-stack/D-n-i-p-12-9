import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { IAuthService, DevMockAuthProvider } from "@nexus/auth";
import { AuthUser } from "@nexus/contracts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  private authService: IAuthService;

  constructor() {
    // In Phase 1: uses dev mock auth provider
    // In Phase 2: can be swapped via DI with SupabaseAuthProvider
    this.authService = new DevMockAuthProvider();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7).trim();
    const user = await this.authService.verifyToken(token);

    if (!user) {
      throw new UnauthorizedException("Invalid or expired session token");
    }

    request.user = user;
    return true;
  }
}
