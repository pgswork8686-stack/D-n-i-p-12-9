/** Limit page input before forwarding it to the validated catalog API. */
export function validCatalogPage(raw?: string): number {
  if (!raw || !/^[1-9][0-9]{0,5}$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : 1;
}

