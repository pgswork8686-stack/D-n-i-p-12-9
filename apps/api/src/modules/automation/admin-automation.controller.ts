import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { AutomationService } from "./automation.service";
import {
  CreateAiDraftRequestDto,
  QueryAutomationJobsDto,
} from "./dto/automation.dto";

@Controller(["admin/automation", "v1/admin/automation"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminAutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get("jobs")
  @RequirePermissions("automation.read")
  async listJobs(@Query() query: QueryAutomationJobsDto): Promise<any> {
    return this.automationService.listJobs(query);
  }

  @Get("jobs/:id")
  @RequirePermissions("automation.read")
  async getJob(@Param("id") id: string): Promise<any> {
    return this.automationService.getJobById(id);
  }

  @Post("jobs/:id/retry")
  @RequirePermissions("automation.manage")
  @HttpCode(HttpStatus.OK)
  async retryJob(@Param("id") id: string, @Req() req: any): Promise<any> {
    const actorId = req.user?.id || req.user?.sub;
    return this.automationService.retryJob(id, actorId);
  }

  @Post("jobs/:id/cancel")
  @RequirePermissions("automation.manage")
  @HttpCode(HttpStatus.OK)
  async cancelJob(@Param("id") id: string, @Req() req: any): Promise<any> {
    const actorId = req.user?.id || req.user?.sub;
    return this.automationService.cancelJob(id, actorId);
  }

  @Post("ai-draft")
  @RequirePermissions("automation.manage")
  @HttpCode(HttpStatus.CREATED)
  async createAiDraft(
    @Body() dto: CreateAiDraftRequestDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user?.id || req.user?.sub;
    const clientKey =
      (req.headers["idempotency-key"] as string | undefined) ||
      (req.headers["x-idempotency-key"] as string | undefined);
    return this.automationService.createAiDraftRequest(actorId, dto, clientKey);
  }
}
