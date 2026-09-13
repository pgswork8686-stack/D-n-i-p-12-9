import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { UsersService } from "./users.service";
import { AssignRoleDto } from "@nexus/contracts";

@Controller("admin")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("users")
  @RequirePermissions("user.read")
  async listUsers() {
    const users = await this.usersService.listUsers();
    return {
      status: "ok",
      count: users.length,
      users,
    };
  }

  @Get("users/:id")
  @RequirePermissions("user.read")
  async getUserById(@Param("id") id: string) {
    const user = await this.usersService.getUserById(id);
    return {
      status: "ok",
      user,
    };
  }

  @Get("roles")
  @RequirePermissions("user.read")
  async listRoles() {
    const roles = await this.usersService.listRoles();
    return {
      status: "ok",
      count: roles.length,
      roles,
    };
  }

  @Get("permissions")
  @RequirePermissions("user.read")
  async listPermissions() {
    const permissions = await this.usersService.listPermissions();
    return {
      status: "ok",
      count: permissions.length,
      permissions,
    };
  }

  @Post("users/:id/roles")
  @RequirePermissions("user.manage")
  @HttpCode(HttpStatus.OK)
  async assignRole(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: AssignRoleDto,
  ) {
    if (!body || !body.role) {
      throw new BadRequestException("Role name is required");
    }

    const actor = req.user!;
    const updatedUser = await this.usersService.assignRole(actor, id, body.role, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      status: "ok",
      message: `Role '${body.role}' successfully assigned`,
      user: updatedUser,
    };
  }

  @Delete("users/:id/roles/:role")
  @RequirePermissions("user.manage")
  @HttpCode(HttpStatus.OK)
  async removeRole(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("role") role: string,
  ) {
    const actor = req.user!;
    const updatedUser = await this.usersService.removeRole(actor, id, role, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      status: "ok",
      message: `Role '${role}' successfully removed`,
      user: updatedUser,
    };
  }
}