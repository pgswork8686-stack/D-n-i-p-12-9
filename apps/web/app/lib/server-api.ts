import { resolveApiUrl } from "@nexus/utils";
import type {
  CategoryDto,
  PaginatedResponse,
  PublicProductListItemDto,
  PublicContentListItemDto,
} from "@nexus/contracts";

/**
 * Server-side API origin. INTERNAL_API_URL lets containers talk to the API on
 * the private network (e.g. http://api:4000); otherwise the public origin is
 * used and validated (HTTPS, no loopback) in production.
 */
export function serverApiUrl(): string {
  const internal = process.env.INTERNAL_API_URL?.trim();
  if (internal) return internal.replace(/\/$/, "");
  return resolveApiUrl();
}

/** Pass `{ revalidate }` for data shared by every page (layout nav). */
type CacheOption = { revalidate?: number };

async function getJson<T>(path: string, fallback: T, cache: CacheOption = {}): Promise<T> {
  try {
    const init: RequestInit & { next?: { revalidate: number } } =
      cache.revalidate !== undefined ? { next: { revalidate: cache.revalidate } } : { cache: "no-store" };
    const res = await fetch(`${serverApiUrl()}${path}`, init);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 0, totalPages: 0 };

/** Like getJson, but tells "API failed" apart from "API returned nothing". */
export type ApiResult<T> = { ok: boolean; data: T };

async function getResult<T>(path: string, fallback: T): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${serverApiUrl()}${path}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, data: fallback };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, data: fallback };
  }
}

/** Product list with an explicit failure flag (homepage error state). */
export function tryListProducts(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return getResult<PaginatedResponse<PublicProductListItemDto>>(`/products?${qs.toString()}`, EMPTY_PAGE);
}

export function listProducts(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return getJson<PaginatedResponse<PublicProductListItemDto>>(
    `/products?${qs.toString()}`,
    EMPTY_PAGE,
  );
}

export function listCategories(cache: CacheOption = {}) {
  return getJson<CategoryDto[]>("/categories", [], cache);
}

export function listPosts(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return getJson<PaginatedResponse<PublicContentListItemDto>>(
    `/v1/content/posts?${qs.toString()}`,
    EMPTY_PAGE,
  );
}
