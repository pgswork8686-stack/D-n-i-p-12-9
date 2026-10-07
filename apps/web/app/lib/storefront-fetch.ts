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
