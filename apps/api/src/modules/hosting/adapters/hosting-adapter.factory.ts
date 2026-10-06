import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { HostingProvider } from "@nexus/database";
import { IHostingAdapter } from "./hosting-adapter.interface";
import { MockHostingAdapter } from "./mock-hosting.adapter";
import { CpanelHostingAdapter } from "./cpanel.adapter";
import { DirectAdminHostingAdapter } from "./directadmin.adapter";
import { CloudflareHostingAdapter } from "./cloudflare.adapter";

@Injectable()
export class HostingAdapterFactory {
  constructor(
    private readonly mockAdapter: MockHostingAdapter,
    private readonly cpanelAdapter: CpanelHostingAdapter,
    private readonly directAdminAdapter: DirectAdminHostingAdapter,
    private readonly cloudflareAdapter: CloudflareHostingAdapter,
  ) {}

  getAdapter(provider: HostingProvider): IHostingAdapter {
    switch (provider) {
      case HostingProvider.CPANEL:
        return this.cpanelAdapter;
      case HostingProvider.DIRECTADMIN:
        return this.directAdminAdapter;
      case HostingProvider.MOCK:
        // The simulated adapter must never serve real customers.
        if (process.env.NODE_ENV === "production") {
          throw new ServiceUnavailableException(
            "Simulated hosting provider is disabled in production",
          );
        }
        return this.mockAdapter;
      default:
        throw new ServiceUnavailableException(
          `Unsupported hosting provider '${provider}'`,
        );
    }
  }

  getCloudflareAdapter(): CloudflareHostingAdapter {
    return this.cloudflareAdapter;
  }
}
