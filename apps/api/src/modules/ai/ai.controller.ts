import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { toSkillDto, WORKFLOWS } from "@nexus/ai-core";
import { requiresHumanApproval } from "@nexus/ai-core";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { AiRuntimeService } from "./ai-runtime.service";
import { AiContextService } from "./ai-context.service";
import { AiExecutionService } from "./ai-execution.service";
import { CreateContextVersionDto, CreateExecutionDto, DecideApprovalDto, RequestActionDto, TenantQueryDto } from "./ai.dto";

@Controller(["ai", "v1/ai"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AiController {
  constructor(
    private readonly runtime: AiRuntimeService,
    private readonly contexts: AiContextService,
    private readonly executions: AiExecutionService,
  ) {}

  @Get("status")
  @RequirePermissions("ai.read")
  status() {
    return this.runtime.status();
  }

  @Get("skills")
  @RequirePermissions("ai.read")
  skills() {
    return this.runtime.getSkills().map(toSkillDto);
  }

  @Get("workflows")
  @RequirePermissions("ai.read")
  workflows() {
    return Object.values(WORKFLOWS);
  }

  @Get("tools")
  @RequirePermissions("ai.read")
  tools() {
    return this.runtime.metadataRegistry.list().map((t) => ({ name: t.name, risk: t.risk, description: t.description, requiresApproval: requiresHumanApproval(t.risk) }));
  }

  @Get("contexts")
  @RequirePermissions("ai.read")
  listContexts(@Req() req: any, @Query() q: TenantQueryDto) {
    return this.contexts.listForTenant(req.user, q.tenantId);
  }

  @Get("contexts/:id/versions")
  @RequirePermissions("ai.read")
  versions(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.contexts.versions(req.user, id);
  }

  @Post("contexts/versions")
  @RequirePermissions("ai.context.manage")
  createVersion(@Req() req: any, @Body() dto: CreateContextVersionDto) {
    return this.contexts.createVersion(req.user, dto);
  }

  @Post("executions")
  @RequirePermissions("ai.execute")
  createExecution(@Req() req: any, @Body() dto: CreateExecutionDto) {
    return this.executions.create(req.user, dto);
  }

  @Get("executions")
  @RequirePermissions("ai.read")
  listExecutions(@Req() req: any, @Query() q: TenantQueryDto) {
    return this.executions.list(req.user, q.tenantId);
  }

  @Get("executions/:id")
  @RequirePermissions("ai.read")
  getExecution(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.executions.get(req.user, id);
  }

  @Post("executions/:id/actions")
  @RequirePermissions("ai.execute")
  requestAction(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RequestActionDto) {
    return this.executions.requestAction(req.user, id, dto);
  }

  @Get("approvals")
  @RequirePermissions("ai.read")
  approvals(@Req() req: any, @Query() q: TenantQueryDto) {
    return this.executions.listApprovals(req.user, q.tenantId, q.status);
  }

  @Post("approvals/:id/decision")
  @RequirePermissions("ai.approve")
  decide(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DecideApprovalDto) {
    return this.executions.decide(req.user, id, dto);
  }
}
