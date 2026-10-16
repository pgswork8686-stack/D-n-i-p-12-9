/**
 * Read Admin bearer identity from the actual authenticated session.
 * The simulated identity controls are strictly development-only.
 *
 * null override: real token; "" override: explicit simulated 401.
 */
export function effectiveAdminToken(
  sessionToken: string | null,
  devOverride: string | null,
  devToolsEnabled: boolean,
): string | null {
  if (!devToolsEnabled || devOverride === null) return sessionToken;
  return devOverride || null;
}
