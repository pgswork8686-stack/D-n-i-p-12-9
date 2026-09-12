import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import { Request } from "express";
import { IAuthService } from "@nexus/auth";
import { AuthUser } from "@nexus/contracts";
import { AUTH_SERVICE } from "./auth.constants";
import { UsersService } from "../users/users.service";

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
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: IAuthService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7).trim();
    const identity = await this.authService.verifyToken(token);

    if (!identity) {
      throw new UnauthorizedException("Invalid or expired session token");
    }

    // Backend database is the sole authority for roles and permissions
    const user = await this.usersService.getOrProvisionUser(identity, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] as string,
    });

    if (!user) {
      throw new UnauthorizedException("User identity could not be verified");
    }

    request.user = user;
    return true;
  }
}

