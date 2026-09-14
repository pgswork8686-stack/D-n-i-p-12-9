import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { DownloadsService } from "./downloads.service";
import {
  CreateProductVersionDto,
  AddVersionFileDto,
} from "./dto/downloads.dto";

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

  @Post("product-versions/:id/files")
  @RequirePermissions("product.write")
  async addFile(
    @Param("id") id: string,
    @Body() dto: AddVersionFileDto,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.downloadsService.addFile(id, dto, actorId);
  }

  @Post("product-versions/:id/publish")
  @RequirePermissions("product.publish")
  async publishVersion(@Param("id") id: string, @Req() req: any) {
    const actorId = req.user.id;
    return this.downloadsService.publishVersion(id, actorId);
  }
}
