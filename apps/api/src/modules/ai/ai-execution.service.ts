import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@nexus/database";
import {
  ApprovalGrant,
  MarketingPorts,
  StepRecord,
  StepRecorder,
  ToolContext,
  WEEKLY_REVIEW_WORKFLOW,
  createMarketingToolRegistry,
  getWorkflow,
  hashToolPayload,
  runWeeklyMarketingReview,
} from "@nexus/ai-core";
import { redactSecretText, redactSecretsDeep } from "@nexus/utils";
import type { AiActionApprovalDto, AiExecutionDto, RequestAiActionResponse } from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { AccessibleTenant, AuthUser, TenantAccessService } from "../tenants/tenant-access.service";
import { AiContextService } from "./ai-context.service";
import { AiRuntimeService } from "./ai-runtime.service";
import { CreateExecutionDto, DecideApprovalDto, RequestActionDto } from "./ai.dto";

const MAX_EXECUTIONS_PER_HOUR = () => Math.max(1, Number(process.env.AI_MAX_EXECUTIONS_PER_HOUR) || 20);

function yesterdayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${parts}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Runs AI workflows with a full audit trail (ai_executions + ai_execution_steps), tenant scope
 * from the authenticated user, redacted inputs/outputs, rate limiting, idempotency and a
 * four-eyes approval gate for WRITE_HIGH_RISK actions.
 */
@Injectable()
export class AiExecutionService {
  constructor(
    private readonly runtime: AiRuntimeService,
    private readonly tenants: TenantAccessService,
    private readonly contexts: AiContextService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  private permissionsOf(user: AuthUser): Set<string> {
    const perms = new Set(user.permissions ?? []);
    if (user.roles?.includes("super_admin")) ["ai.read", "ai.execute", "ai.approve"].forEach((p) => perms.add(p));
    return perms;
  }

  private ports(tenant: AccessibleTenant): MarketingPorts {
    return {
      loadContext: () => this.contexts.resolveForExecution(tenant),
      getPeriodMeasures: async (_tenantId, from, to) => {
        const m = await this.analytics.periodMeasures(tenant.id, { from, to });
        return { totals: m.totals, byChannel: m.byChannel, daysWithData: m.daysWithData, currency: tenant.defaultCurrency };
      },
      getCampaigns: (_tenantId, from, to) => this.analytics.campaignRows(tenant.id, { from, to }),
      getSeoPages: (_tenantId, from, to) => this.analytics.seoPages(tenant.id, { from, to }),
      createReportDraft: (input) =>
        prisma.aiReportDraft.create({
          data: { tenantId: tenant.id, executionId: input.executionId, kind: input.kind, title: input.title, body: redactSecretsDeep(input.body) as any, createdById: input.userId },
          select: { id: true },
        }),
    };
  }

  private recorder(executionId: string, startSeq = 0): StepRecorder & { next(): number } {
    let seq = startSeq;
    return {
      next: () => seq,
      record: async (s: StepRecord) => {
        seq += 1;
        await prisma.aiExecutionStep.create({
          data: {
            executionId,
            seq,
            name: s.name,
            kind: s.kind,
            risk: s.risk,
            status: s.status,
            inputSummary: (s.inputSummary ?? undefined) as any,
            outputSummary: (s.outputSummary ?? undefined) as any,
            error: s.error ? redactSecretText(s.error) : null,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
          },
        });
      },
    };
  }

  private async toDto(id: string): Promise<AiExecutionDto> {
    const e = await prisma.aiExecution.findUniqueOrThrow({ where: { id }, include: { steps: { orderBy: { seq: "asc" } }, report: { select: { id: true } } } });
    return {
      id: e.id,
      tenantId: e.tenantId,
      userId: e.userId,
      workflow: e.workflow,
      workflowVersion: e.workflowVersion,
      skills: e.skills,
      contextVersions: e.contextVersions as any,
      status: e.status,
      provider: e.provider,
      model: e.model,
      resultSummary: e.resultSummary,
      result: (e.result as any) ?? null,
      error: e.error,
      startedAt: e.startedAt.toISOString(),
      finishedAt: e.finishedAt?.toISOString() ?? null,
      reportDraftId: e.report?.id ?? null,
      steps: e.steps.map((s) => ({
        seq: s.seq,
        name: s.name,
        kind: s.kind,
        risk: s.risk,
        status: s.status,
        inputSummary: s.inputSummary,
        outputSummary: s.outputSummary,
        error: s.error,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt.toISOString(),
      })),
    };
  }

  async create(user: AuthUser, dto: CreateExecutionDto): Promise<AiExecutionDto> {
    this.runtime.assertEnabled();
    const workflow = getWorkflow(dto.workflow);
    if (!workflow) throw new BadRequestException("Workflow không tồn tại");
    const tenant = await this.tenants.assertAccess(user, dto.tenantId, { type: "CLIENT" });
    const role = await this.tenants.roleOn(user, tenant);
    if (role !== "ANALYST" && role !== "MANAGER" && role !== "STAFF") throw new ForbiddenException("Vai trò VIEWER không được chạy workflow AI");

    if (dto.idempotencyKey) {
      const existing = await prisma.aiExecution.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: dto.idempotencyKey } } });
      if (existing) {
        if (existing.tenantId !== tenant.id || existing.workflow !== dto.workflow) throw new ConflictException("idempotencyKey đã dùng cho yêu cầu khác");
        return this.toDto(existing.id);
      }
    }
    const recent = await prisma.aiExecution.count({ where: { userId: user.id, startedAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent >= MAX_EXECUTIONS_PER_HOUR()) throw new HttpException("Quá nhiều lượt chạy AI trong một giờ", HttpStatus.TOO_MANY_REQUESTS);

    const weekEnding = dto.weekEnding ?? yesterdayIn(tenant.timezone);
    const usedSkills = this.runtime.getSkills().filter((s) => (workflow.skills as string[]).includes(s.name));
    const provider = this.runtime.getProvider();
    let execution;
    try {
      execution = await prisma.aiExecution.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          workflow: workflow.name,
          workflowVersion: workflow.version,
          skills: usedSkills.map((s) => `${s.name}@${s.version}#${s.contentHash.slice(0, 12)}`),
          contextVersions: {},
          status: "RUNNING",
          provider: provider.name,
          model: provider.model,
          input: redactSecretsDeep({ workflow: workflow.name, weekEnding }) as any,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002" && dto.idempotencyKey) {
        const raced = await prisma.aiExecution.findUniqueOrThrow({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: dto.idempotencyKey } } });
        return this.toDto(raced.id);
      }
      throw err;
    }

    const ctx: ToolContext = {
      executionId: execution.id,
      tenantId: tenant.id,
      userId: user.id,
      permissions: this.permissionsOf(user),
      allowedTools: new Set(WEEKLY_REVIEW_WORKFLOW.tools.filter((t) => t !== "ads.update_budget")),
    };
    try {
      const out = await runWeeklyMarketingReview({ input: { weekEnding }, tools: createMarketingToolRegistry(this.ports(tenant)), ctx, recorder: this.recorder(execution.id), provider });
      await prisma.aiExecution.update({
        where: { id: execution.id },
        data: { status: "SUCCEEDED", result: redactSecretsDeep(out.review) as any, resultSummary: out.review.summary.headline, contextVersions: out.contextVersions as any, finishedAt: new Date() },
      });
      await this.audit.logAction({ action: "AI_EXECUTION_SUCCEEDED", entity: "AiExecution", entityId: execution.id, actorId: user.id, details: { tenantId: tenant.id, workflow: workflow.name, reportDraftId: out.reportDraftId } });
    } catch (err: any) {
      const message = redactSecretText(String(err?.message || err)).slice(0, 1000);
      await prisma.aiExecution.update({ where: { id: execution.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
      await this.audit.logAction({ action: "AI_EXECUTION_FAILED", entity: "AiExecution", entityId: execution.id, actorId: user.id, details: { tenantId: tenant.id, workflow: workflow.name, error: message } });
    }
    return this.toDto(execution.id);
  }

  private async loadAccessible(user: AuthUser, executionId: string) {
    const e = await prisma.aiExecution.findUnique({ where: { id: executionId } });
    if (!e) throw new NotFoundException("Không tìm thấy lượt chạy");
    const tenant = await this.tenants.assertAccess(user, e.tenantId); // 404 for other tenants
    return { e, tenant };
  }

  async get(user: AuthUser, id: string): Promise<AiExecutionDto> {
    await this.loadAccessible(user, id);
    return this.toDto(id);
  }

  async list(user: AuthUser, tenantId: string) {
    const tenant = await this.tenants.assertAccess(user, tenantId);
    return prisma.aiExecution.findMany({
      where: { tenantId: tenant.id },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: { id: true, workflow: true, workflowVersion: true, status: true, resultSummary: true, provider: true, startedAt: true, finishedAt: true, userId: true },
    });
  }

  /**
   * Requests a tool action on behalf of an execution. WRITE_HIGH_RISK tools only run with an
   * APPROVED approval bound to the same payload hash; otherwise a PENDING approval is created.
   */
  async requestAction(user: AuthUser, executionId: string, dto: RequestActionDto): Promise<RequestAiActionResponse> {
    this.runtime.assertEnabled();
    const { e, tenant } = await this.loadAccessible(user, executionId);
    const role = await this.tenants.roleOn(user, tenant);
    if (role !== "ANALYST" && role !== "MANAGER" && role !== "STAFF") throw new ForbiddenException("Vai trò VIEWER không được yêu cầu hành động AI");
    const workflow = getWorkflow(e.workflow);
    if (!workflow || !workflow.tools.includes(dto.tool)) {
      return { outcome: "DENIED", approvalId: null, result: null, message: `Công cụ ${dto.tool} không thuộc workflow ${e.workflow}` };
    }
    const registry = createMarketingToolRegistry(this.ports(tenant));
    const tool = registry.get(dto.tool)!;
    const ctx: ToolContext = { executionId: e.id, tenantId: tenant.id, userId: user.id, permissions: this.permissionsOf(user), allowedTools: new Set(workflow.tools) };
    const maxSeq = await prisma.aiExecutionStep.aggregate({ where: { executionId: e.id }, _max: { seq: true } });
    const recorder = this.recorder(e.id, maxSeq._max.seq ?? 0);

    let approval: ApprovalGrant | null = null;
    if (tool.risk === "WRITE_HIGH_RISK") {
      const payloadHash = hashToolPayload(dto.tool, dto.payload);
      const existing = await prisma.aiActionApproval.findFirst({ where: { executionId: e.id, tool: dto.tool, payloadHash }, orderBy: { createdAt: "desc" } });
      if (existing?.status === "APPROVED") approval = { id: existing.id, tool: existing.tool, payloadHash: existing.payloadHash, status: "APPROVED" };
      else if (existing?.status === "PENDING") {
        return { outcome: "APPROVAL_REQUIRED", approvalId: existing.id, result: null, message: "Đang chờ người duyệt" };
      }
    }

    const out = await registry.invoke(ctx, dto.tool, dto.payload, recorder, approval);
    if (out.outcome === "DENIED") return { outcome: "DENIED", approvalId: null, result: null, message: out.reason };
    if (out.outcome === "APPROVAL_REQUIRED") {
      const created = await prisma.aiActionApproval.create({
        data: { executionId: e.id, tenantId: tenant.id, tool: dto.tool, risk: tool.risk, payload: redactSecretsDeep(dto.payload) as any, payloadHash: out.payloadHash, status: "PENDING", requestedById: user.id },
      });
      await this.audit.logAction({ action: "AI_ACTION_APPROVAL_REQUESTED", entity: "AiActionApproval", entityId: created.id, actorId: user.id, details: { executionId: e.id, tool: dto.tool, risk: tool.risk } });
      return { outcome: "APPROVAL_REQUIRED", approvalId: created.id, result: null, message: "Hành động rủi ro cao cần người khác phê duyệt" };
    }
    await this.audit.logAction({ action: "AI_ACTION_EXECUTED", entity: "AiExecution", entityId: e.id, actorId: user.id, details: { tool: dto.tool, risk: tool.risk, approvalId: approval?.id ?? null } });
    return { outcome: "EXECUTED", approvalId: approval?.id ?? null, result: redactSecretsDeep(out.result), message: "Đã thực hiện" };
  }

  private approvalDto(a: any): AiActionApprovalDto {
    return { ...a, decidedAt: a.decidedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() };
  }

  async listApprovals(user: AuthUser, tenantId: string, status?: "PENDING" | "APPROVED" | "REJECTED") {
    const tenant = await this.tenants.assertAccess(user, tenantId);
    const rows = await prisma.aiActionApproval.findMany({ where: { tenantId: tenant.id, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((a) => this.approvalDto(a));
  }

  async decide(user: AuthUser, approvalId: string, dto: DecideApprovalDto): Promise<AiActionApprovalDto> {
    const a = await prisma.aiActionApproval.findUnique({ where: { id: approvalId } });
    if (!a) throw new NotFoundException("Không tìm thấy yêu cầu phê duyệt");
    await this.tenants.assertAccess(user, a.tenantId);
    if (a.requestedById === user.id) throw new ForbiddenException("Người yêu cầu không được tự phê duyệt (four-eyes)");
    const res = await prisma.aiActionApproval.updateMany({
      where: { id: a.id, status: "PENDING" },
      data: { status: dto.decision, decidedById: user.id, decidedAt: new Date(), reason: dto.reason?.trim() || null },
    });
    if (res.count === 0) throw new ConflictException("Yêu cầu đã được xử lý");
    await this.audit.logAction({ action: dto.decision === "APPROVED" ? "AI_ACTION_APPROVED" : "AI_ACTION_REJECTED", entity: "AiActionApproval", entityId: a.id, actorId: user.id, details: { tool: a.tool, executionId: a.executionId } });
    return this.approvalDto(await prisma.aiActionApproval.findUniqueOrThrow({ where: { id: a.id } }));
  }
}
