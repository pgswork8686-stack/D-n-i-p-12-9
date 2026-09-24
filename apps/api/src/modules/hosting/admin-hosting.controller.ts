import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { HostingService } from "./hosting.service";
import {
  CreateHostingServerDto,
  UpdateHostingServerDto,
  AdminSuspendAccountDto,
} from "./dto/hosting.dto";
import {
  HostingServerDto,
  HostingAccountDto,
  HostingAccountStatus,
} from "@nexus/contracts";

@Controller(["admin/hosting", "v1/admin/hosting"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminHostingController {
  constructor(private readonly hostingService: HostingService) {}

  // Server management
  @Get("servers")
  @RequirePermissions("hosting.read")
  async listServers(): Promise<HostingServerDto[]> {
    return this.hostingService.adminListServers();
  }

  @Get("servers/:id")
  @RequirePermissions("hosting.read")
  async getServer(@Param("id") id: string): Promise<HostingServerDto> {
    return this.hostingService.adminGetServer(id);
  }

  @Post("servers")
  @RequirePermissions("hosting.manage")
  async createServer(
    @Body() dto: CreateHostingServerDto,
  ): Promise<HostingServerDto> {
    return this.hostingService.adminCreateServer(dto);
  }

  @Patch("servers/:id")
  @RequirePermissions("hosting.manage")
  async updateServer(
    @Param("id") id: string,
    @Body() dto: UpdateHostingServerDto,
  ): Promise<HostingServerDto> {
    return this.hostingService.adminUpdateServer(id, dto);
  }

  @Delete("servers/:id")
  @RequirePermissions("hosting.manage")
  async deleteServer(@Param("id") id: string): Promise<{ success: boolean }> {
    return this.hostingService.adminDeleteServer(id);
  }

  // Account management
  @Get("accounts")
  @RequirePermissions("hosting.read")
  async listAccounts(
    @Query("serverId") serverId?: string,
    @Query("status") status?: HostingAccountStatus,
    @Query("userId") userId?: string,
  ): Promise<HostingAccountDto[]> {
    return this.hostingService.adminListAccounts({
      serverId,
      status,
      userId,
    });
  }

  @Get("accounts/:id")
  @RequirePermissions("hosting.read")
  async getAccount(@Param("id") id: string): Promise<HostingAccountDto> {
    return this.hostingService.adminGetAccount(id);
  }

  @Post("accounts/:id/suspend")
  @RequirePermissions("hosting.manage")
  async suspendAccount(
    @Param("id") id: string,
    @Body() dto: AdminSuspendAccountDto,
  ): Promise<HostingAccountDto> {
    return this.hostingService.adminSuspendAccount(id, dto);
  }

  @Post("accounts/:id/unsuspend")
  @RequirePermissions("hosting.manage")
  async unsuspendAccount(
    @Param("id") id: string,
  ): Promise<HostingAccountDto> {
    return this.hostingService.adminUnsuspendAccount(id);
  }

  @Post("accounts/:id/terminate")
  @RequirePermissions("hosting.manage")
  async terminateAccount(
    @Param("id") id: string,
  ): Promise<HostingAccountDto> {
    return this.hostingService.adminTerminateAccount(id);
  }

  @Post("accounts/:id/retry")
  @RequirePermissions("hosting.manage")
  async retryProvision(
    @Param("id") id: string,
  ): Promise<HostingAccountDto> {
    return this.hostingService.adminRetryProvision(id);
  }
}
