import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ContentService } from "./content.service";
import {
  CreateContentPostDto,
  UpdateContentPostDto,
  ContentPostTransitionDto,
  CreateContentCategoryDto,
  UpdateContentCategoryDto,
  QueryContentPostsDto,
} from "./dto/content.dto";
import {
  AdminContentPostDto,
  ContentCategoryDto,
  PaginatedResponse,
} from "@nexus/contracts";

@Controller(["admin/content", "v1/admin/content"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminContentController {
  constructor(private readonly contentService: ContentService) {}

  // --------------------------------------------------------
  // Content Posts
  // --------------------------------------------------------

  @Get("posts")
  @RequirePermissions("content.read")
  async listPosts(
    @Query() query: QueryContentPostsDto,
  ): Promise<PaginatedResponse<AdminContentPostDto>> {
    return this.contentService.listAdminPosts(query);
  }

  @Get("posts/:id")
  @RequirePermissions("content.read")
  async getPost(@Param("id") id: string): Promise<AdminContentPostDto> {
    return this.contentService.getAdminPost(id);
  }

  @Post("posts")
  @RequirePermissions("content.write")
  async createPost(
    @Body() dto: CreateContentPostDto,
    @Req() req: any,
  ): Promise<AdminContentPostDto> {
    const actorId = req.user?.id;
    return this.contentService.createPost(actorId, dto);
  }

  @Patch("posts/:id")
  @RequirePermissions("content.write")
  async updatePost(
    @Param("id") id: string,
    @Body() dto: UpdateContentPostDto,
    @Req() req: any,
  ): Promise<AdminContentPostDto> {
    const actorId = req.user?.id;
    return this.contentService.updatePost(id, actorId, dto);
  }

  @Post(["posts/:id/transition", "posts/:id/transitions"])
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("content.publish")
  async transitionPost(
    @Param("id") id: string,
    @Body() dto: ContentPostTransitionDto,
    @Req() req: any,
  ): Promise<AdminContentPostDto> {
    const actorId = req.user?.id;
    return this.contentService.transitionPost(id, actorId, dto);
  }

  // --------------------------------------------------------
  // Content Categories
  // --------------------------------------------------------

  @Get("categories")
  @RequirePermissions("content.read")
  async listCategories(): Promise<ContentCategoryDto[]> {
    return this.contentService.listAdminCategories();
  }

  @Post("categories")
  @RequirePermissions("content.write")
  async createCategory(
    @Body() dto: CreateContentCategoryDto,
  ): Promise<ContentCategoryDto> {
    return this.contentService.createCategory(dto);
  }

  @Patch("categories/:id")
  @RequirePermissions("content.write")
  async updateCategory(
    @Param("id") id: string,
    @Body() dto: UpdateContentCategoryDto,
  ): Promise<ContentCategoryDto> {
    return this.contentService.updateCategory(id, dto);
  }
}
