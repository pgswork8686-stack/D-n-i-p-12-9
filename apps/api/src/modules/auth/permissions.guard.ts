import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { PERMISSIONS_KEY } from "./require-permissions.decorator";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no specific permissions are required on this route, allow
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException("User not authenticated");
    }

    // Super admin has full access without hardcoding scattered if statements
    if (user.roles && user.roles.includes("super_admin")) {
      return true;
    }

    // Check if user has all required permissions
    const userPermissions = user.permissions || [];
    const hasAll = requiredPermissions.every((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasAll) {
      // Record audit event for authorization denial
      await this.auditService.logAction({
        action: "AUTHORIZATION_DENIED",
        entity: "Route",
        entityId: request.path,
        actorId: user.id,
        details: {
          path: request.path,
          method: request.method,
          requiredPermissions,
          userRoles: user.roles,
          userPermissions,
        },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] as string,
      });

      throw new ForbiddenException(
        "Forbidden: Insufficient permissions to access this resource",
      );
    }

    return true;
  }
}