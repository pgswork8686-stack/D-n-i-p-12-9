import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
} from "@nestjs/common";
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
  async getPayment(@Param("id") id: string): Promise<PaymentDto> {
    return this.paymentsService.getPayment(id);
  }

  @Post("test-callback")
  async handleTestCallback(
    @Headers() headers: Record<string, string>,
    @Body() dto: TestPaymentCallbackDto,
  ): Promise<TestPaymentCallbackResponse> {
    return this.paymentsService.processTestCallback(dto, headers);
  }

  @Post(":id/reconcile")
  async reconcilePayment(
    @Param("id") id: string,
    @Body() dto?: ReconcilePaymentDto,
  ): Promise<ReconcilePaymentResponse> {
    return this.paymentsService.reconcilePayment(id, dto);
  }
}

