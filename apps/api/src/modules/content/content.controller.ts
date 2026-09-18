import {
  Controller,
  Get,
  Param,
  Query,
} from "@nestjs/common";
import { ContentService } from "./content.service";
import { QueryPublicPostsDto } from "./dto/content.dto";
import {
  PublicContentListItemDto,
  PublicContentPostDto,
  ContentCategoryDto,
} from "@nexus/contracts";

@Controller(["content", "v1/content"])
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get("posts")
  async listPublicPosts(
    @Query() query: QueryPublicPostsDto,
  ): Promise<{ items: PublicContentListItemDto[]; total: number }> {
    return this.contentService.listPublicPosts(query);
  }

  @Get("posts/:slug")
  async getPublicPostBySlug(
    @Param("slug") slug: string,
  ): Promise<PublicContentPostDto> {
    return this.contentService.getPublicPostBySlug(slug);
  }

  @Get("categories")
  async listPublicCategories(): Promise<ContentCategoryDto[]> {
    return this.contentService.listPublicCategories();
  }
}
