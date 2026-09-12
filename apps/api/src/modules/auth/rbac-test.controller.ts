import { Controller, Get, UseGuards, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "./auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePermissions } from "./require-permissions.decorator";

@Controller("rbac/test")
@UseGuards(AuthGuard, PermissionsGuard)
export class RbacTestController {
  @Get("customer")
  @RequirePermissions("profile.read")
  testCustomer(@Req() req: Request) {
    return {
      status: "ok",
      access: "granted",
      level: "customer",
      userId: req.user!.id,
      roles: req.user!.roles,
    };
  }

  @Get("admin")
  @RequirePermissions("user.manage")
  testAdmin(@Req() req: Request) {
    return {
      status: "ok",
      access: "granted",
      level: "admin",
      userId: req.user!.id,
      roles: req.user!.roles,
    };
  }

  @Get("audit")
  @RequirePermissions("audit.read")
  testAudit(@Req() req: Request) {
    return {
      status: "ok",
      access: "granted",
      level: "audit",
      userId: req.user!.id,
      roles: req.user!.roles,
    };
  }
}