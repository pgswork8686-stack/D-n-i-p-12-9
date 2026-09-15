import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { PaymentsService } from "./payments.service";
import {
  TestPaymentCallbackDto,
  ReconcilePaymentDto,
} from "./dto/payments.dto";
import {
  TestPaymentCallbackResponse,
  ReconcilePaymentResponse,
  PaymentDto,
} from "@nexus/contracts";

@Controller(["payments", "v1/payments"])
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(":id")
  @UseGuards(AuthGuard)
  async getPayment(
    @Param("id") id: string,
    @Req() req: any,
  ): Promise<PaymentDto> {
    return this.paymentsService.getPayment(id, req.user);
  }

  @Post("test-callback")
  async handleTestCallback(
    @Headers() headers: Record<string, string>,
    @Body() dto: TestPaymentCallbackDto,
  ): Promise<TestPaymentCallbackResponse> {
    return this.paymentsService.processTestCallback(dto, headers);
  }

  @Post(":id/reconcile")
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions("payment.manage")
  async reconcilePayment(
    @Param("id") id: string,
    @Body() dto?: ReconcilePaymentDto,
  ): Promise<ReconcilePaymentResponse> {
    return this.paymentsService.reconcilePayment(id, dto);
  }
}

