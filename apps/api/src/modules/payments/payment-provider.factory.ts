import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Optional,
} from "@nestjs/common";
import { Currency } from "@nexus/database";
import { PaymentProviderAdapter } from "./payment-provider.interface";
import { StripePaymentProvider } from "./stripe-payment.provider";
import { TestPaymentProvider } from "./test-payment.provider";
import { SepayPaymentProvider } from "./sepay-payment.provider";

@Injectable()
export class PaymentProviderFactory {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor(
    private readonly stripeProvider: StripePaymentProvider,
    private readonly testProvider: TestPaymentProvider,
    // Optional so callers constructing the factory by hand (acceptance
    // scripts) keep working; Nest always injects the module singleton.
    @Optional()
    private readonly sepayProvider: SepayPaymentProvider = new SepayPaymentProvider(),
  ) {
    this.adapters.set("stripe", stripeProvider);
    this.adapters.set("test", testProvider);
    this.adapters.set("sepay", sepayProvider);
  }

  private isTestProviderAvailable(): boolean {
    return (
      process.env.NODE_ENV !== "production" &&
      process.env.ENABLE_TEST_PAYMENT_PROVIDER === "true"
    );
  }

  /** Providers a customer may choose at checkout, in display order. */
  listAvailableProviders(): Array<{ id: string; currencies: Currency[] }> {
    const result: Array<{ id: string; currencies: Currency[] }> = [];
    if (this.sepayProvider.isEnabled()) {
      result.push({ id: "sepay", currencies: [Currency.VND] });
    }
    if (this.stripeProvider.isEnabled()) {
      result.push({ id: "stripe", currencies: [Currency.USD, Currency.VND] });
    }
    if (this.isTestProviderAvailable()) {
      result.push({ id: "test", currencies: [Currency.USD, Currency.VND] });
    }
    return result;
  }

  getAdapter(providerName: string): PaymentProviderAdapter {
    const normalized = (providerName || "").trim().toLowerCase();

    if (normalized === "test" && !this.isTestProviderAvailable()) {
      throw new ForbiddenException("Test payment provider is unavailable");
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
