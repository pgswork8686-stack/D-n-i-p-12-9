import { Controller, Get, UseGuards, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "./auth.guard";
import { AuthMeResponse } from "@nexus/contracts";

@Controller("auth")
export class AuthController {
  @Get("me")
  @UseGuards(AuthGuard)
  getMe(@Req() req: Request): AuthMeResponse {
    const user = req.user!;
    return {
      id: user.id,
      email: user.email,
      profile: {
        displayName: user.profile?.displayName || null,
        firstName: user.profile?.firstName || null,
        lastName: user.profile?.lastName || null,
        avatarUrl: user.profile?.avatarUrl || null,
        bio: user.profile?.bio || null,
      },
      roles: user.roles,
      permissions: user.permissions,
    };
  }
}