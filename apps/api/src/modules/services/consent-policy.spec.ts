import "reflect-metadata";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateServiceInquiryDto } from "./dto/services.dto";
import { DEV_CONSENT_VERSION, recordConsent, resolveConsentPolicy } from "./consent-policy";

const prod = { production: true, servicesEnabled: true };

describe("resolveConsentPolicy", () => {
  it("uses clearly-marked development defaults outside production and reports them as not configured", () => {
    const policy = resolveConsentPolicy({ production: false, servicesEnabled: true });
    expect(policy.version).toBe(DEV_CONSENT_VERSION);
    expect(policy.configured).toBe(false);
  });

  it("refuses to start in production with the module on and no version or no policy URL", () => {
    expect(() => resolveConsentPolicy({ ...prod })).toThrow(/required in production/);
    expect(() => resolveConsentPolicy({ ...prod, version: "2026-10" })).toThrow(/required in production/);
    expect(() => resolveConsentPolicy({ ...prod, privacyPolicyUrl: "https://pgs.example/privacy" })).toThrow(/required in production/);
  });

  it("still boots in production while FEATURE_SERVICES is off (the marketplace must keep running)", () => {
    expect(() => resolveConsentPolicy({ production: true, servicesEnabled: false })).not.toThrow();
  });

  it("accepts a fully configured production policy", () => {
    const policy = resolveConsentPolicy({ ...prod, version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy" });
    expect(policy).toEqual({ version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy", configured: true });
  });

  it.each([
    ["http in production", "http://pgs.example/privacy"],
    ["credentials in the URL", "https://user:pw@pgs.example/privacy"],
    ["a non-URL", "not a url"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("rejects a policy URL with %s", (_label, url) => {
    expect(() => resolveConsentPolicy({ ...prod, version: "v1", privacyPolicyUrl: url })).toThrow();
  });

  it("rejects malformed versions", () => {
    expect(() => resolveConsentPolicy({ production: false, servicesEnabled: true, version: "has space" })).toThrow();
    expect(() => resolveConsentPolicy({ production: false, servicesEnabled: true, version: "x".repeat(65) })).toThrow();
  });
});

describe("recordConsent", () => {
  const policy = { version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy", configured: true };
  const now = new Date("2026-10-16T01:02:03.000Z");

  it("stores the server version and one server timestamp", () => {
    expect(recordConsent(policy, { consentAccepted: true, consentVersion: "2026-10" }, now)).toEqual({
      consentVersion: "2026-10",
      consentAt: now,
      marketingConsent: false,
      marketingConsentAt: null,
    });
  });

  it("keeps marketing consent independent and opt-in", () => {
    const withMarketing = recordConsent(policy, { consentAccepted: true, consentVersion: "2026-10", marketingConsent: true }, now);
    expect(withMarketing.marketingConsent).toBe(true);
    expect(withMarketing.marketingConsentAt).toEqual(now);
    // Marketing consent alone never satisfies the required consent.
    expect(() => recordConsent(policy, { consentAccepted: false, consentVersion: "2026-10", marketingConsent: true }, now)).toThrow(
      BadRequestException,
    );
  });

  it("treats anything but literal true as no consent", () => {
    for (const v of [false, undefined, null, "true", 1, "on"]) {
      expect(() => recordConsent(policy, { consentAccepted: v as any, consentVersion: "2026-10" }, now)).toThrow(BadRequestException);
    }
    for (const v of ["true", 1, "yes", null]) {
      expect(recordConsent(policy, { consentAccepted: true, consentVersion: "2026-10", marketingConsent: v as any }, now).marketingConsent).toBe(false);
    }
  });

  it("rejects a stale or forged version with 409", () => {
    expect(() => recordConsent(policy, { consentAccepted: true, consentVersion: "2020-01" }, now)).toThrow(ConflictException);
  });
});

describe("CreateServiceInquiryDto consent fields (multipart strings)", () => {
  const base = {
    serviceSlug: "ai-chatbot-development",
    companyName: "ABC",
    contactName: "A",
    contactEmail: "a@example.com",
    requirements: "x",
    consentVersion: "v1",
  };
  const check = async (extra: Record<string, unknown>) => {
    const dto = plainToInstance(CreateServiceInquiryDto, { ...base, ...extra });
    return { dto, errors: (await validate(dto)).map((e) => e.property) };
  };

  it("converts the exact strings true/false", async () => {
    const { dto, errors } = await check({ consentAccepted: "true", marketingConsent: "false" });
    expect(errors).toEqual([]);
    expect(dto.consentAccepted).toBe(true);
    expect(dto.marketingConsent).toBe(false);
  });

  it("does not let loosely truthy values become booleans", async () => {
    for (const v of ["1", "yes", "on", "TRUE", 1]) {
      expect((await check({ consentAccepted: v })).errors).toContain("consentAccepted");
      expect((await check({ consentAccepted: "true", marketingConsent: v })).errors).toContain("marketingConsent");
    }
  });

  it("requires consentAccepted and consentVersion to be present", async () => {
    expect((await check({})).errors).toContain("consentAccepted");
    expect((await check({ consentAccepted: "true", consentVersion: "" })).errors).toContain("consentVersion");
  });

  it("leaves marketingConsent undefined when omitted (defaults to not selected)", async () => {
    const { dto, errors } = await check({ consentAccepted: "true" });
    expect(errors).toEqual([]);
    expect(dto.marketingConsent).toBeUndefined();
  });
});
