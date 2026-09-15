import * as semver from "semver";

/**
 * Authoritative Semantic Versioning Utilities for Phase 8.
 *
 * Invariants:
 * 1. Strictly conforms to SemVer 2.0.0.
 * 2. Rejects malformed version strings.
 * 3. Never compares versions lexicographically (e.g., "1.10.0" > "1.2.0").
 * 4. Supports valid prereleases (e.g., "2.0.0-beta.1").
 */

/**
 * Checks whether a version string is a valid Semantic Version.
 */
export function isValidSemver(rawVersion: string | null | undefined): boolean {
  if (!rawVersion || typeof rawVersion !== "string") {
    return false;
  }
  const trimmed = rawVersion.trim();
  if (!trimmed) {
    return false;
  }
  return semver.valid(trimmed) !== null;
}

/**
 * Normalizes and validates a semantic version string.
 * Throws an Error if the version string is invalid.
 */
export function cleanSemver(rawVersion: string | null | undefined): string {
  if (!rawVersion || typeof rawVersion !== "string") {
    throw new Error("Version is required and must be a non-empty string");
  }
  const trimmed = rawVersion.trim();
  const cleaned = semver.clean(trimmed) || semver.valid(trimmed);
  if (!cleaned) {
    throw new Error(
      `Invalid semantic version format: '${rawVersion}'. Must follow SemVer 2.0.0 (e.g., 1.0.0, 1.2.3-beta.1).`,
    );
  }
  return cleaned;
}

/**
 * Compares two semantic version strings.
 * Returns:
 *  - 0 if v1 == v2
 *  - 1 if v1 > v2
 *  - -1 if v1 < v2
 */
export function compareSemver(v1: string, v2: string): number {
  const c1 = cleanSemver(v1);
  const c2 = cleanSemver(v2);
  return semver.compare(c1, c2);
}

/**
 * Returns true if v1 is strictly greater than v2.
 */
export function isSemverGreater(v1: string, v2: string): boolean {
  return compareSemver(v1, v2) > 0;
}

/**
 * Returns true if v1 is greater than or equal to v2.
 */
export function isSemverGte(v1: string, v2: string): boolean {
  return compareSemver(v1, v2) >= 0;
}

/**
 * Sorts an array of versioned objects in descending order (highest version first).
 */
export function sortSemverDescending<T extends { version: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const va = cleanSemver(a.version);
    const vb = cleanSemver(b.version);
    return semver.rcompare(va, vb);
  });
}

/**
 * Finds the highest version from a list of versioned objects.
 */
export function findLatestVersion<T extends { version: string }>(
  items: T[],
): T | null {
  if (!items || items.length === 0) {
    return null;
  }
  const sorted = sortSemverDescending(items);
  return sorted[0] || null;
}
