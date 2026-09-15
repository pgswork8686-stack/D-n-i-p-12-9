import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { DownloadsService } from "./downloads.service";
import { RequestDownloadDto } from "./dto/downloads.dto";

@Controller("v1/downloads")
@UseGuards(AuthGuard)
export class DownloadsController {
  constructor(private readonly downloadsService: DownloadsService) {}

  @Post("request")
  async requestDownload(@Body() dto: RequestDownloadDto, @Req() req: any) {
    const userId = req.user.id;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers?.["user-agent"];

    return this.downloadsService.requestDownload(
      userId,
      dto,
      ipAddress,
      userAgent,
    );
  }
}
