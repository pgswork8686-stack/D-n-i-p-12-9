export interface ArticleAuthor {
  id?: string;
  name?: string | null;
  email?: string | null;
  profile?: {
    displayName?: string | null;
  } | null;
}

export interface ArticleInput {
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  featuredImageUrl?: string | null;
  ogImageUrl?: string | null;
  publishedAt?: string | Date | null;
  updatedAt?: string | Date | null;
  author?: ArticleAuthor | null;
  category?: {
    name: string;
    slug: string;
  } | null;
}

export interface BuildArticleJsonLdOptions {
  post: ArticleInput;
  siteUrl: string;
}

export interface BuildArticleMetadataOptions {
  post: ArticleInput | null;
  siteUrl: string;
}

/**
 * Builds truthful Schema.org Article JSON-LD structured data.
 * - Author truthfulness: omit author if no authoritative public display name or name is present
 * - Never fabricate "NEXUSTHEME Editorial Team" or placeholder names
 * - Publisher is truthfully set to NEXUSTHEME organization
 */
export function buildArticleJsonLd({
  post,
  siteUrl,
}: BuildArticleJsonLdOptions): Record<string, any> {
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
  const canonical = post.canonicalUrl || `${normalizedSiteUrl}/blog/${post.slug}`;

  const jsonLd: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt || `${post.title} on NEXUSTHEME.`,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical,
    },
    publisher: {
      "@type": "Organization",
      name: "NEXUSTHEME",
      url: normalizedSiteUrl,
    },
  };

  if (post.publishedAt) {
    jsonLd.datePublished =
      typeof post.publishedAt === "string"
        ? post.publishedAt
        : post.publishedAt.toISOString();
  }

  if (post.updatedAt) {
    jsonLd.dateModified =
      typeof post.updatedAt === "string"
        ? post.updatedAt
        : post.updatedAt.toISOString();
  }

  if (post.ogImageUrl || post.featuredImageUrl) {
    jsonLd.image = post.ogImageUrl || post.featuredImageUrl;
  }

  // Author truthfulness:
  // Only emit author if an authoritative display name or name is present.
  // Never fabricate "NEXUSTHEME Editorial Team".
  const authorName = post.author?.profile?.displayName || post.author?.name;
  if (authorName && authorName.trim()) {
    jsonLd.author = {
      "@type": "Person",
      name: authorName.trim(),
    };
  }

  return jsonLd;
}

/**
 * Builds metadata for blog article detail page.
 */
export function buildArticleMetadata({
  post,
  siteUrl,
}: BuildArticleMetadataOptions) {
  if (!post) {
    return {
      title: "Article Not Found | NEXUSTHEME",
      description: "The requested article could not be found.",
    };
  }

  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
  const title = post.seoTitle || post.title;
  const description =
    post.seoDescription || post.excerpt || `${post.title} on NEXUSTHEME.`;
  const canonical = post.canonicalUrl || `${normalizedSiteUrl}/blog/${post.slug}`;
  const ogImage = post.ogImageUrl || post.featuredImageUrl;

  return {
    title: `${title} | NEXUSTHEME`,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "NEXUSTHEME",
      type: "article",
      ...(post.publishedAt
        ? {
            publishedTime:
              typeof post.publishedAt === "string"
                ? post.publishedAt
                : post.publishedAt.toISOString(),
          }
        : {}),
      ...(post.updatedAt
        ? {
            modifiedTime:
              typeof post.updatedAt === "string"
                ? post.updatedAt
                : post.updatedAt.toISOString(),
          }
        : {}),
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}
