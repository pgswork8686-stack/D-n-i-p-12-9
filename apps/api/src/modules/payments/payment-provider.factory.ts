import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PaymentProviderAdapter } from "./payment-provider.interface";
import { StripePaymentProvider } from "./stripe-payment.provider";
import { TestPaymentProvider } from "./test-payment.provider";

@Injectable()
export class PaymentProviderFactory {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor(
    private readonly stripeProvider: StripePaymentProvider,
    private readonly testProvider: TestPaymentProvider,
  ) {
    this.adapters.set("stripe", stripeProvider);
    this.adapters.set("test", testProvider);
  }

  getAdapter(providerName: string): PaymentProviderAdapter {
    const normalized = (providerName || "").trim().toLowerCase();

    if (normalized === "test") {
      const isProduction = process.env.NODE_ENV === "production";
      const isExplicitlyEnabled =
        process.env.ENABLE_TEST_PAYMENT_PROVIDER === "true";

      if (isProduction || !isExplicitlyEnabled) {
        throw new ForbiddenException("Test payment provider is unavailable");
      }
    }

    const adapter = this.adapters.get(normalized);
    if (!adapter) {
      throw new NotFoundException(
        `Payment provider '${providerName}' is not supported or configured`,
      );
    }

    return adapter;
  }
}
