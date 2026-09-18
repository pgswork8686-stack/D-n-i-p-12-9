const RESERVED_SLUGS = new Set([
  "category",
  "categories",
  "new",
  "admin",
  "api",
  "tag",
  "tags",
  "edit",
  "draft",
  "login",
  "blog",
  "products",
  "orders",
  "cart",
  "checkout",
  "account",
  "portal",
  "robots",
  "sitemap",
  "feed",
  "rss",
]);

/**
 * Remove Vietnamese accents and diacritics.
 */
export function removeVietnameseAccents(str: string): string {
  if (!str) return "";
  let result = str;
  result = result.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  result = result.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  result = result.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  result = result.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  result = result.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  result = result.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  result = result.replace(/đ/g, "d");
  result = result.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
  result = result.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
  result = result.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
  result = result.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
  result = result.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
  result = result.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
  result = result.replace(/Đ/g, "D");
  // Normalize unicode
  return result
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Generate a clean, URL-safe, normalized slug from arbitrary input text.
 */
export function slugify(text: string): string {
  if (!text) return "";
  const withoutAccents = removeVietnameseAccents(text.trim().toLowerCase());
  const slug = withoutAccents
    .replace(/[^a-z0-9\s-_]/g, "") // remove characters that are not alphanumeric, spaces, dashes or underscores
    .replace(/[\s_]+/g, "-") // replace spaces and underscores with hyphen
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  return slug;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
