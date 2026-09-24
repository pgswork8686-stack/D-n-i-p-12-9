import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { HostingService } from "./hosting.service";
import {
  CreateHostingAccountDto,
  CreateDnsRecordDto,
  UpdateDnsRecordDto,
  PurgeCacheDto,
} from "./dto/hosting.dto";
import {
  HostingAccountDto,
  HostingDnsRecordDto,
  HostingSsoResponseDto,
  PurgeCacheResponseDto,
} from "@nexus/contracts";

@Controller(["hosting", "v1/hosting"])
@UseGuards(AuthGuard)
export class HostingController {
  constructor(private readonly hostingService: HostingService) {}

  @Get("accounts")
  async listMyAccounts(@Req() req: any): Promise<HostingAccountDto[]> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.listMyAccounts(userId);
  }

  @Post("accounts")
  async createAccount(
    @Body() dto: CreateHostingAccountDto,
    @Req() req: any,
  ): Promise<HostingAccountDto> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.provisionAccountInternal({
      userId,
      domain: dto.domain,
      serverId: dto.serverId,
      username: dto.username,
      packagePlan: dto.packagePlan,
      entitlementId: dto.entitlementId,
      orderId: dto.orderId,
    });
  }

  @Get("accounts/:id")
  async getMyAccount(
    @Param("id") id: string,
    @Req() req: any,
  ): Promise<HostingAccountDto> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.getMyAccount(userId, id);
  }

  @Post("accounts/:id/sso")
  async generateSsoUrl(
    @Param("id") id: string,
    @Req() req: any,
  ): Promise<HostingSsoResponseDto> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.generateSsoUrl(userId, id);
  }

  @Get("accounts/:id/dns")
  async listDnsRecords(
    @Param("id") id: string,
    @Req() req: any,
  ): Promise<HostingDnsRecordDto[]> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.listAccountDnsRecords(userId, id);
  }

  @Post("accounts/:id/dns")
  async createDnsRecord(
    @Param("id") id: string,
    @Body() dto: CreateDnsRecordDto,
    @Req() req: any,
  ): Promise<HostingDnsRecordDto> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.createDnsRecord(userId, id, dto);
  }

  @Patch("accounts/:id/dns/:recordId")
  async updateDnsRecord(
    @Param("id") id: string,
    @Param("recordId") recordId: string,
    @Body() dto: UpdateDnsRecordDto,
    @Req() req: any,
  ): Promise<HostingDnsRecordDto> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.updateDnsRecord(userId, id, recordId, dto);
  }

  @Delete("accounts/:id/dns/:recordId")
  async deleteDnsRecord(
    @Param("id") id: string,
    @Param("recordId") recordId: string,
    @Req() req: any,
  ): Promise<{ success: boolean }> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.deleteDnsRecord(userId, id, recordId);
  }

  @Post("accounts/:id/purge-cache")
  async purgeCache(
    @Param("id") id: string,
    @Body() dto: PurgeCacheDto,
    @Req() req: any,
  ): Promise<PurgeCacheResponseDto> {
    const userId = req.user.id || req.user.sub;
    return this.hostingService.purgeCdnCache(userId, id, dto);
  }
}
