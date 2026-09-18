export enum ContentStatus {
  IDEA = "IDEA",
  DRAFT = "DRAFT",
  AI_DRAFT = "AI_DRAFT",
  REVIEW = "REVIEW",
  SCHEDULED = "SCHEDULED",
  PUBLISHED = "PUBLISHED",
  ARCHIVED = "ARCHIVED",
}

export enum ContentType {
  ARTICLE = "ARTICLE",
  PAGE = "PAGE",
}

export interface ContentCategoryDto {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  createdAt: string;
  updatedAt: string;
  postCount?: number;
}

export interface CreateContentCategoryDto {
  name: string;
  slug?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface UpdateContentCategoryDto {
  name?: string;
  slug?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface AdminContentPostDto {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  content: string;
  status: ContentStatus;
  contentType: ContentType;
  authorId?: string | null;
  author?: {
    id: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  ogImageUrl?: string | null;
  publishedAt?: string | null;
  scheduledAt?: string | null;
  categoryId?: string | null;
  category?: ContentCategoryDto | null;
  readingTimeMinutes?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicContentListItemDto {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  publishedAt: string;
  category?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  readingTimeMinutes?: number | null;
}

export interface PublicContentPostDto {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  content: string;
  contentType: ContentType;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  ogImageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  publishedAt: string;
  updatedAt: string;
  category?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  readingTimeMinutes?: number | null;
}

export interface CreateContentPostDto {
  title: string;
  slug?: string;
  excerpt?: string;
  content: string;
  status?: ContentStatus.DRAFT | ContentStatus.IDEA;
  contentType?: ContentType;
  categoryId?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  featuredImageUrl?: string;
  featuredImageAlt?: string;
  ogImageUrl?: string;
}

export interface UpdateContentPostDto {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  contentType?: ContentType;
  categoryId?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  featuredImageUrl?: string;
  featuredImageAlt?: string;
  ogImageUrl?: string;
  scheduledAt?: string | null;
}

export interface ContentPostTransitionDto {
  targetStatus: ContentStatus;
  scheduledAt?: string;
  notes?: string;
}

export interface QueryContentPostsDto {
  status?: ContentStatus;
  categoryId?: string;
  search?: string;
  page?: number;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "publishedAt" | "title";
  sortOrder?: "asc" | "desc";
}

export interface QueryPublicPostsDto {
  categorySlug?: string;
  search?: string;
  page?: number;
  limit?: number;
  offset?: number;
}

