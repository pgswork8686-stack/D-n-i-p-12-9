import {
  isValidSemver,
  cleanSemver,
  compareSemver,
  isSemverGreater,
  isSemverGte,
  sortSemverDescending,
  findLatestVersion,
} from "./semver";

describe("Semantic Versioning Utilities", () => {
  describe("isValidSemver", () => {
    it("accepts valid semver strings", () => {
      expect(isValidSemver("1.0.0")).toBe(true);
      expect(isValidSemver("0.1.0")).toBe(true);
      expect(isValidSemver("1.2.3-alpha.1")).toBe(true);
      expect(isValidSemver("2.0.0-beta.2+build.123")).toBe(true);
    });

    it("rejects invalid semver strings", () => {
      expect(isValidSemver("")).toBe(false);
      expect(isValidSemver("   ")).toBe(false);
      expect(isValidSemver("1")).toBe(false);
      expect(isValidSemver("1.0")).toBe(false);
      expect(isValidSemver("v1.0.0-invalid..1")).toBe(false);
      expect(isValidSemver("abc")).toBe(false);
      expect(isValidSemver(null as any)).toBe(false);
      expect(isValidSemver(undefined as any)).toBe(false);
    });
  });

  describe("cleanSemver", () => {
    it("cleans and normalizes valid semver strings", () => {
      expect(cleanSemver("1.0.0")).toBe("1.0.0");
      expect(cleanSemver("  v1.2.3  ")).toBe("1.2.3");
      expect(cleanSemver("2.0.0-beta.1")).toBe("2.0.0-beta.1");
    });

    it("throws on invalid semver strings", () => {
      expect(() => cleanSemver("1.0")).toThrow("Invalid semantic version format");
      expect(() => cleanSemver("not-semver")).toThrow("Invalid semantic version format");
      expect(() => cleanSemver("")).toThrow("Version is required");
    });
  });

  describe("compareSemver", () => {
    it("compares versions non-lexicographically", () => {
      expect(compareSemver("1.10.0", "1.2.0")).toBe(1);
      expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);
      expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
      expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
      expect(compareSemver("1.0.0", "1.0.0-beta")).toBe(1);
    });
  });

  describe("isSemverGreater and isSemverGte", () => {
    it("checks strict greater than", () => {
      expect(isSemverGreater("1.2.0", "1.1.9")).toBe(true);
      expect(isSemverGreater("1.1.9", "1.2.0")).toBe(false);
      expect(isSemverGreater("1.0.0", "1.0.0")).toBe(false);
    });

    it("checks greater than or equal", () => {
      expect(isSemverGte("1.2.0", "1.1.9")).toBe(true);
      expect(isSemverGte("1.0.0", "1.0.0")).toBe(true);
      expect(isSemverGte("0.9.0", "1.0.0")).toBe(false);
    });
  });

  describe("sortSemverDescending and findLatestVersion", () => {
    const list = [
      { version: "1.2.0", name: "v1.2" },
      { version: "1.10.0", name: "v1.10" },
      { version: "1.2.1", name: "v1.2.1" },
      { version: "2.0.0-alpha", name: "v2.0-alpha" },
      { version: "0.9.5", name: "v0.9.5" },
    ];

    it("sorts versions descending correctly", () => {
      const sorted = sortSemverDescending(list);
      expect(sorted.map((s) => s.version)).toEqual([
        "2.0.0-alpha",
        "1.10.0",
        "1.2.1",
        "1.2.0",
        "0.9.5",
      ]);
    });

    it("finds the latest version", () => {
      expect(findLatestVersion(list)?.version).toBe("2.0.0-alpha");
      expect(findLatestVersion([])).toBeNull();
    });
  });
});
