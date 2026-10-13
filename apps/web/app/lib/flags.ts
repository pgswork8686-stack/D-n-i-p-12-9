/**
 * Server-side feature flags for the storefront, read at request time (not
 * NEXT_PUBLIC_, so they are never baked into the client bundle).
 *
 * FEATURE_CONSULT_FORM_DEMO — show the ST01 consultation form in simulation
 * mode (validates, sends nothing). Default false: production shows a working
 * support CTA instead, because no API receives consultation requests yet
 * (docs/frontend/backend-proposals.md P3). Staging also runs NODE_ENV=production,
 * so the flag — not NODE_ENV — decides. Never enable it on production.
 */
export function consultFormDemoEnabled(): boolean {
  return process.env.FEATURE_CONSULT_FORM_DEMO === "true";
}
