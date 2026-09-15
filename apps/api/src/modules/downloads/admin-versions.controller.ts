import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { DownloadsService } from "./downloads.service";
import {
  CreateProductVersionDto,
  UploadVersionFileDto,
} from "./dto/downloads.dto";
import { resolveMaxUploadBytes } from "@nexus/contracts";

@Controller("admin")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminVersionsController {
  constructor(private readonly downloadsService: DownloadsService) {}

  @Post("products/:productId/versions")
  @RequirePermissions("product.write")
  async createVersion(
    @Param("productId") productId: string,
    @Body() dto: CreateProductVersionDto,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.downloadsService.createVersion(productId, dto, actorId);
  }

  @Get("products/:productId/versions")
  @RequirePermissions("product.read")
  async listVersions(@Param("productId") productId: string) {
    return this.downloadsService.listVersions(productId);
  }

  @Get("product-versions/:id")
  @RequirePermissions("product.read")
  async getVersion(@Param("id") id: string) {
    return this.downloadsService.getVersion(id);
  }

  @Post("product-versions/:id/files/upload")
  @RequirePermissions("product.write")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: resolveMaxUploadBytes(process.env.MAX_UPLOAD_BYTES),
      },
    }),
  )
  async uploadFile(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadVersionFileDto,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.downloadsService.uploadFile(
      id,
      file,
      dto.isPrimary ?? false,
      actorId,
    );
  }

  @Post("product-versions/:id/publish")
  @RequirePermissions("product.publish")
  async publishVersion(@Param("id") id: string, @Req() req: any) {
    const actorId = req.user.id;
    return this.downloadsService.publishVersion(id, actorId);
  }
}
