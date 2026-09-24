import { Module } from "@nestjs/common";
import { HostingService } from "./hosting.service";
import { HostingController } from "./hosting.controller";
import { AdminHostingController } from "./admin-hosting.controller";
import { HostingAdapterFactory } from "./adapters/hosting-adapter.factory";
import { MockHostingAdapter } from "./adapters/mock-hosting.adapter";
import { CpanelHostingAdapter } from "./adapters/cpanel.adapter";
import { DirectAdminHostingAdapter } from "./adapters/directadmin.adapter";
import { CloudflareHostingAdapter } from "./adapters/cloudflare.adapter";

@Module({
  controllers: [HostingController, AdminHostingController],
  providers: [
    HostingService,
    HostingAdapterFactory,
    MockHostingAdapter,
    CpanelHostingAdapter,
    DirectAdminHostingAdapter,
    CloudflareHostingAdapter,
  ],
  exports: [HostingService, HostingAdapterFactory],
})
export class HostingModule {}
