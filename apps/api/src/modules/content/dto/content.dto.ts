import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  MaxLength,
  IsISO8601,
  IsInt,
  Min,
  Max,
  IsIn,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import {
  ContentStatus,
  ContentType,
  CreateContentPostDto as ICreateContentPostDto,
  UpdateContentPostDto as IUpdateContentPostDto,
  ContentPostTransitionDto as IContentPostTransitionDto,
  CreateContentCategoryDto as ICreateContentCategoryDto,
  UpdateContentCategoryDto as IUpdateContentCategoryDto,
  QueryContentPostsDto as IQueryContentPostsDto,
  QueryPublicPostsDto as IQueryPublicPostsDto,
} from "@nexus/contracts";

export class CreateContentPostDto implements ICreateContentPostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  excerpt?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content!: string;

  @IsIn([ContentStatus.DRAFT, ContentStatus.IDEA], {
    message: "Initial status must be either DRAFT or IDEA. Publishing and scheduling require workflow transitions.",
  })
  @IsOptional()
  status?: ContentStatus.DRAFT | ContentStatus.IDEA;

  @IsEnum(ContentType)
  @IsOptional()
  contentType?: ContentType;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  seoTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  seoDescription?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  canonicalUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  featuredImageUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  featuredImageAlt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  ogImageUrl?: string;
}

export class UpdateContentPostDto implements IUpdateContentPostDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  excerpt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100000)
  content?: string;

  @IsEnum(ContentType)
  @IsOptional()
  contentType?: ContentType;

  @IsUUID()
  @IsOptional()
  categoryId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  seoTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  seoDescription?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  canonicalUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  featuredImageUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  featuredImageAlt?: string;

  @IsString()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  ogImageUrl?: string;
}

export class ContentPostTransitionDto implements IContentPostTransitionDto {
  @IsEnum(ContentStatus)
  @IsNotEmpty()
  targetStatus!: ContentStatus;

  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class CreateContentCategoryDto implements ICreateContentCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  seoTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  seoDescription?: string;
}

export class UpdateContentCategoryDto implements IUpdateContentCategoryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  seoTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  seoDescription?: string;
}

export class QueryContentPostsDto implements IQueryContentPostsDto {
  @IsEnum(ContentStatus)
  @IsOptional()
  status?: ContentStatus;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;

  @IsString()
  @IsOptional()
  sortBy?: "createdAt" | "publishedAt" | "title";

  @IsString()
  @IsOptional()
  sortOrder?: "asc" | "desc";
}

export class QueryPublicPostsDto implements IQueryPublicPostsDto {
  @IsString()
  @IsOptional()
  categorySlug?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}
