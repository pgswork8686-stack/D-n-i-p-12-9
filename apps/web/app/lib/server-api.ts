import { resolveApiUrl } from "@nexus/utils";
import type {
  CategoryDto,
  PaginatedResponse,
  PublicProductListItemDto,
  PublicContentListItemDto,
  ServiceDto,
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

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${serverApiUrl()}${path}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 0, totalPages: 0 };

export function listProducts(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return getJson<PaginatedResponse<PublicProductListItemDto>>(
    `/products?${qs.toString()}`,
    EMPTY_PAGE,
  );
}

export function listCategories() {
  return getJson<CategoryDto[]>("/categories", []);
}

export function listPosts(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return getJson<PaginatedResponse<PublicContentListItemDto>>(
    `/v1/content/posts?${qs.toString()}`,
    EMPTY_PAGE,
  );
}

/** Returns null when the services module is disabled (API answers 404). */
export async function listServices(): Promise<ServiceDto[] | null> {
  try {
    const res = await fetch(`${serverApiUrl()}/v1/services`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) return [];
    return (await res.json()) as ServiceDto[];
  } catch {
    return [];
  }
}

export async function getService(slug: string): Promise<ServiceDto | null> {
  try {
    const res = await fetch(`${serverApiUrl()}/v1/services/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ServiceDto;
  } catch {
    return null;
  }
}
