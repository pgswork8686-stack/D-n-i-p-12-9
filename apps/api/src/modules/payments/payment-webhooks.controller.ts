import {
  Controller,
  Post,
  Param,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { PaymentsService } from "./payments.service";
import { PaymentWebhookResponse } from "@nexus/contracts";

@Controller(["v1/webhooks/payments", "webhooks/payments"])
export class PaymentWebhooksController {
  private readonly logger = new Logger(PaymentWebhooksController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(":provider")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param("provider") provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<PaymentWebhookResponse> {
    const rawBody: Buffer =
      req.rawBody ||
      (Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(
            typeof req.body === "string"
              ? req.body
              : JSON.stringify(req.body || {}),
          ));

    return this.paymentsService.handleWebhook(provider, rawBody, headers);
  }
}
