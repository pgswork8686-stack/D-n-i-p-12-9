/**
 * Runtime feature flags for modules that are not production-ready yet.
 *
 * Defaults: every flag is OFF in production and ON elsewhere (so local
 * development and acceptance suites keep exercising the code). Each flag can
 * be forced with FEATURE_<NAME>=true|false.
 */
export const FEATURE_NAMES = [
  "hosting",
  "membership",
  "affiliate",
  "finance",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export type FeatureFlags = Record<FeatureName, boolean>;

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off", ""].includes(value)) return false;
  return undefined;
}

export function resolveFeatureFlags(
  env: Record<string, string | undefined> = process.env,
): FeatureFlags {
  const defaultOn = env.NODE_ENV !== "production";
  const flags = {} as FeatureFlags;
  for (const name of FEATURE_NAMES) {
    const explicit = parseBool(env[`FEATURE_${name.toUpperCase()}`]);
    flags[name] = explicit ?? defaultOn;
  }
  return flags;
}

export function isFeatureEnabled(
  name: FeatureName,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveFeatureFlags(env)[name];
}
