import { serverApiUrl } from "./server-api";

export async function fetchProductBySlug(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<any | null> {
  const apiUrl = serverApiUrl();
  let res: Response;
  try {
    res = await fetchFn(`${apiUrl}/products/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
  } catch {
    throw new Error("Unable to connect to product catalog service.");
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Product catalog service returned error: ${res.status}`);
  }

  return await res.json();
}

export async function fetchArticleBySlug(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<any | null> {
  const apiUrl = serverApiUrl();
  let res: Response;
  try {
    res = await fetchFn(
      `${apiUrl}/v1/content/posts/${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
      },
    );
  } catch {
    throw new Error("Unable to connect to content service.");
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Content service returned error: ${res.status}`);
  }

  return await res.json();
}

/** Published CMS PAGE by slug (ST13); null when it does not exist or is not published. */
export async function fetchPageBySlug(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<any | null> {
  const apiUrl = serverApiUrl();
  let res: Response;
  try {
    res = await fetchFn(`${apiUrl}/v1/content/pages/${encodeURIComponent(slug)}`, { cache: "no-store" });
  } catch {
    throw new Error("Unable to connect to content service.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Content service returned error: ${res.status}`);
  return await res.json();
}

/**
 * Which policy pages are published right now. Used for the footer: it must never link to a 404, so a
 * page that is missing, unpublished or unreachable is simply left out. Never throws.
 */
export async function fetchPublishedPolicySlugs(
  slugs: readonly string[],
  fetchFn: typeof fetch = fetch,
  /** The footer tolerates a 5-minute cache; the policy index page must always be current. */
  options: { noStore?: boolean } = {},
): Promise<string[]> {
  const apiUrl = serverApiUrl();
  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const res = await fetchFn(`${apiUrl}/v1/content/pages/${encodeURIComponent(slug)}`, {
          ...(options.noStore ? { cache: "no-store" } : { next: { revalidate: 300 } }),
          signal: AbortSignal.timeout(options.noStore ? 8000 : 3000),
        } as RequestInit);
        return res.ok ? slug : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((slug): slug is string => slug !== null);
}
