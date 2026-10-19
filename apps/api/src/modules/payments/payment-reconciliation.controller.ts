import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import {
  PaymentReconciliationService,
  ReconciliationCaseView,
  ReconciliationDetail,
  ReconciliationList,
  ReconciliationResolution,
} from "./payment-reconciliation.service";

/** Permissions that may VIEW cases (any one is enough). Acting on a case needs payment.manage. */
const READ_PERMISSIONS = ["finance.read", "payment.read", "payment.manage"];

function assertCanRead(user: { roles?: string[]; permissions?: string[] } | undefined): void {
  if (!user) throw new ForbiddenException();
  if (user.roles?.includes("super_admin")) return;
  const granted = user.permissions ?? [];
  if (!READ_PERMISSIONS.some((p) => granted.includes(p))) {
    throw new ForbiddenException("Cần quyền finance.read hoặc payment.read để xem đối soát thanh toán");
  }
}

@Controller(["admin/payments/reconciliation", "v1/admin/payments/reconciliation"])
@UseGuards(AuthGuard, PermissionsGuard)
export class PaymentReconciliationController {
  constructor(private readonly service: PaymentReconciliationService) {}

  @Get()
  list(
    @Req() req: any,
    @Query("status") status?: string,
    @Query("reason") reason?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ): Promise<ReconciliationList> {
    assertCanRead(req.user);
    return this.service.list({ status, reason, page: Number(page), limit: Number(limit) });
  }

  @Get(":id")
  get(@Req() req: any, @Param("id") id: string): Promise<ReconciliationDetail> {
    assertCanRead(req.user);
    return this.service.get(id);
  }

  @Post(":id/requery")
  @RequirePermissions("payment.manage")
  requery(@Req() req: any, @Param("id") id: string): Promise<ReconciliationCaseView> {
    return this.service.requery(id, req.user.id);
  }

  @Post(":id/resolve")
  @RequirePermissions("payment.manage")
  resolve(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { resolution?: ReconciliationResolution; note?: string },
  ): Promise<ReconciliationCaseView> {
    return this.service.resolve(id, req.user.id, body?.resolution as ReconciliationResolution, body?.note ?? "");
  }
}
