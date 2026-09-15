import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PaymentsService } from "./payments.service";
import { CreatePaymentSessionDto } from "./dto/payments.dto";
import { PaymentSessionResponse } from "@nexus/contracts";

@Controller(["v1/orders", "orders"])
@UseGuards(AuthGuard)
export class PaymentSessionController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(":orderId/payment-session")
  async createPaymentSession(
    @Req() req: any,
    @Param("orderId") orderId: string,
    @Body() dto?: CreatePaymentSessionDto,
  ): Promise<PaymentSessionResponse> {
    const userId = req.user.id;
    return this.paymentsService.createPaymentSession(userId, orderId, dto);
  }
}
