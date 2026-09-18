-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'DRAFT', 'AI_DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ARTICLE', 'PAGE');

-- CreateTable
CREATE TABLE "content_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "content_type" "ContentType" NOT NULL DEFAULT 'ARTICLE',
    "author_id" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "canonical_url" TEXT,
    "featured_image_url" TEXT,
    "featured_image_alt" TEXT,
    "og_image_url" TEXT,
    "published_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "category_id" TEXT,
    "reading_time_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_categories_slug_key" ON "content_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "content_posts_slug_key" ON "content_posts"("slug");

-- CreateIndex
CREATE INDEX "content_posts_status_idx" ON "content_posts"("status");

-- CreateIndex
CREATE INDEX "content_posts_status_published_at_idx" ON "content_posts"("status", "published_at");

-- CreateIndex
CREATE INDEX "content_posts_status_scheduled_at_idx" ON "content_posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "content_posts_category_id_idx" ON "content_posts"("category_id");

-- CreateIndex
CREATE INDEX "content_posts_author_id_idx" ON "content_posts"("author_id");

-- AddForeignKey
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "content_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
