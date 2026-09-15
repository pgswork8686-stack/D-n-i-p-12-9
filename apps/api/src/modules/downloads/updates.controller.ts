import { Controller, Post, Body, Req } from "@nestjs/common";
import { DownloadsService } from "./downloads.service";
import { CheckUpdateDto } from "./dto/downloads.dto";

@Controller("v1/updates")
export class UpdatesController {
  constructor(private readonly downloadsService: DownloadsService) {}

  @Post("check")
  async checkUpdate(@Body() dto: CheckUpdateDto, @Req() req: any) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers?.["user-agent"];

    return this.downloadsService.checkUpdate(dto, ipAddress, userAgent);
  }
}
