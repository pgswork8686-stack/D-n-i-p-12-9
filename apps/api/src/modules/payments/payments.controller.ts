import { Controller, Post, Body } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { TestPaymentCallbackDto } from "./dto/payments.dto";
import { TestPaymentCallbackResponse } from "@nexus/contracts";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("test-callback")
  async handleTestCallback(
    @Body() dto: TestPaymentCallbackDto,
  ): Promise<TestPaymentCallbackResponse> {
    return this.paymentsService.processTestCallback(dto);
  }
}
