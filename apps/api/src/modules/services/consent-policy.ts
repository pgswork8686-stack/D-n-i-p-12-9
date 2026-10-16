import { BadRequestException, ConflictException } from "@nestjs/common";
import { ServiceConsentConfigDto } from "@nexus/contracts";

/**
 * Consent policy for the public inquiry form.
 *
 * The version and the privacy-policy URL come from deployment config, never from the
 * request and never from code: this repo does not ship a privacy policy, so the operator must
 * publish one and set both values. Until they do, production refuses to start with
 * FEATURE_SERVICES on (see `resolveConsentPolicy`), so a form without a real policy behind
 * it cannot go live by accident.
 */
export interface ConsentPolicy extends ServiceConsentConfigDto {
  /** True only when both values were explicitly configured (always true in production). */
  configured: boolean;
}

/** Development fallback. Marked so a stored value is obviously not a reviewed policy version. */
export const DEV_CONSENT_VERSION = "dev-unreviewed";
export const DEV_PRIVACY_POLICY_URL = "http://localhost:3000/privacy-policy";

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface ConsentPolicyEnv {
  version?: string;
  privacyPolicyUrl?: string;
  production: boolean;
  /** FEATURE_SERVICES; the API must still boot for the marketplace while the module is off. */
  servicesEnabled: boolean;
}

export function resolveConsentPolicy(env: ConsentPolicyEnv): ConsentPolicy {
  const version = env.version?.trim();
  const url = env.privacyPolicyUrl?.trim();

  if (version && !VERSION_PATTERN.test(version)) {
    throw new Error("[Services] SERVICE_CONSENT_VERSION may only contain letters, digits, '.', '_' and '-' (max 64)");
  }
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("[Services] PRIVACY_POLICY_URL must be an absolute URL");
    }
    if (parsed.username || parsed.password) {
      throw new Error("[Services] PRIVACY_POLICY_URL must not embed credentials");
    }
    if (env.production && parsed.protocol !== "https:") {
      throw new Error("[Services] PRIVACY_POLICY_URL must use https in production");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("[Services] PRIVACY_POLICY_URL must be an http(s) URL");
    }
  }

  if (env.production && env.servicesEnabled && (!version || !url)) {
    throw new Error(
      "[Services] SERVICE_CONSENT_VERSION and PRIVACY_POLICY_URL are required in production when FEATURE_SERVICES is enabled " +
        "(publish a reviewed privacy policy first)",
    );
  }

  return {
    version: version || DEV_CONSENT_VERSION,
    privacyPolicyUrl: url || DEV_PRIVACY_POLICY_URL,
    configured: Boolean(version && url),
  };
}

export interface ConsentInput {
  consentAccepted: boolean;
  consentVersion: string;
  marketingConsent?: boolean;
}

export interface RecordedConsent {
  consentVersion: string;
  consentAt: Date;
  marketingConsent: boolean;
  marketingConsentAt: Date | null;
}

/**
 * Validates the client's consent claim and returns what the server will store. The stored
 * version and timestamps are the server's own: the client can only confirm it saw the current
 * version, so it cannot backdate, pick another version, or imply marketing consent.
 */
export function recordConsent(policy: ConsentPolicy, input: ConsentInput, now: Date = new Date()): RecordedConsent {
  if (input.consentAccepted !== true) {
    throw new BadRequestException("Bạn cần đồng ý xử lý dữ liệu để gửi yêu cầu.");
  }
  if (input.consentVersion !== policy.version) {
    // The policy changed after the form was rendered: make the customer read the new one.
    throw new ConflictException("Chính sách quyền riêng tư đã được cập nhật. Vui lòng tải lại trang và xác nhận lại.");
  }
  const marketing = input.marketingConsent === true;
  return {
    consentVersion: policy.version,
    consentAt: now,
    marketingConsent: marketing,
    marketingConsentAt: marketing ? now : null,
  };
}
