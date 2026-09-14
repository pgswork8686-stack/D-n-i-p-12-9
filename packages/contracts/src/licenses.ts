export type LicenseStatus = "ACTIVE" | "REVOKED";

export type LicenseActivationStatus = "ACTIVE" | "DEACTIVATED";

export interface CustomerLicenseDto {
  id: string;
  productId: string;
  variantId: string;
  status: LicenseStatus;
  keyMasked: string;
  maxActivations: number | null;
  activeActivations: number;
  expiresAt: string | null;
  updatesUntil: string | null;
  supportUntil: string | null;
  createdAt: string;
}

export interface RevealLicenseResponse {
  licenseId: string;
  licenseKey: string;
  keyMasked: string;
}

export interface ActivateLicenseRequest {
  licenseKey: string;
  domain: string;
  metadata?: Record<string, any>;
}

export interface ActivateLicenseResponse {
  valid: boolean;
  status: LicenseActivationStatus;
  domain: string;
  activatedAt: string;
  expiresAt: string | null;
  updatesUntil: string | null;
  supportUntil: string | null;
}

export interface ValidateLicenseRequest {
  licenseKey: string;
  domain: string;
}

export interface ValidateLicenseResponse {
  valid: boolean;
  status?: LicenseActivationStatus;
  domain?: string;
  expiresAt?: string | null;
  updatesUntil?: string | null;
  supportUntil?: string | null;
  error?: string;
}

export interface DeactivateLicenseRequest {
  licenseKey: string;
  domain: string;
}

export interface DeactivateLicenseResponse {
  success: boolean;
  domain: string;
  deactivatedAt: string;
}

export interface AdminLicenseDto {
  id: string;
  entitlementId: string;
  userId: string;
  productId: string;
  variantId: string;
  status: LicenseStatus;
  keyLast4: string;
  maxActivations: number | null;
  activeActivations: number;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}
