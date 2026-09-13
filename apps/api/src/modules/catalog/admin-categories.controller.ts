import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/catalog.dto";

@Controller("admin/categories")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @RequirePermissions("product.write")
  async createCategory(@Body() dto: CreateCategoryDto, @Req() req: any): Promise<any> {
    const actorId = req.user.id;
    return this.categoriesService.createCategory(dto, actorId);
  }

  @Get()
  @RequirePermissions("product.read")
  async listCategories(): Promise<any> {
    return this.categoriesService.listCategories(true);
  }

  @Get(":id")
  @RequirePermissions("product.read")
  async getCategory(@Param("id") id: string): Promise<any> {
    return this.categoriesService.getCategoryById(id);
  }

  @Patch(":id")
  @RequirePermissions("product.write")
  async updateCategory(
    @Param("id") id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    return this.categoriesService.updateCategory(id, dto, actorId);
  }
}
