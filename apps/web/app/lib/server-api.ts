import { resolveApiUrl } from "@nexus/utils";
import type {
  CategoryDto,
  PaginatedResponse,
  PublicProductListItemDto,
  PublicContentListItemDto,
  ServiceConsentConfigDto,
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

async function fetchServices(path: string, fetchFn: typeof fetch): Promise<Response> {
  try {
    return await fetchFn(`${serverApiUrl()}${path}`, { cache: "no-store" });
  } catch {
    throw new Error("Unable to connect to the services catalog.");
  }
}

/**
 * Returns null when the services module is disabled (API answers 404). Outages
 * and 5xx responses throw, so the page shows the error boundary instead of an
 * empty catalog.
 */
export async function listServices(fetchFn: typeof fetch = fetch): Promise<ServiceDto[] | null> {
  const res = await fetchServices("/v1/services", fetchFn);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Services catalog returned ${res.status}`);
  return (await res.json()) as ServiceDto[];
}

/**
 * Consent version and privacy-policy link for the inquiry form. Throws on outages and on a
 * malformed answer: a form that cannot show the policy it asks people to accept must not render.
 */
export async function getServiceConsent(fetchFn: typeof fetch = fetch): Promise<ServiceConsentConfigDto> {
  const res = await fetchServices("/v1/service-inquiries/consent", fetchFn);
  if (!res.ok) throw new Error(`Services consent config returned ${res.status}`);
  const body = (await res.json()) as Partial<ServiceConsentConfigDto> | null;
  const version = typeof body?.version === "string" ? body.version : "";
  let url = "";
  try {
    const parsed = new URL(String(body?.privacyPolicyUrl ?? ""));
    if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.toString();
  } catch {
    url = "";
  }
  if (!version || !url) throw new Error("Services consent config is incomplete");
  return { version, privacyPolicyUrl: url };
}

/** Returns null for unknown, unpublished or disabled services; throws on outages. */
export async function getService(slug: string, fetchFn: typeof fetch = fetch): Promise<ServiceDto | null> {
  const res = await fetchServices(`/v1/services/${encodeURIComponent(slug)}`, fetchFn);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Services catalog returned ${res.status}`);
  return (await res.json()) as ServiceDto;
}
