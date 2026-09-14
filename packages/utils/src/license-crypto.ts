import * as crypto from "crypto";

/**
 * Authoritative Cryptographic Utilities for Phase 7 Internal License Engine.
 *
 * Invariants:
 * 1. License keys are high-entropy, generated using crypto.randomBytes() (NEVER Math.random()).
 * 2. Lookup & validation use SHA-256 digest of normalized license key.
 * 3. Customer reveal uses AES-256-GCM encryption at rest with 12-byte IV and 16-byte auth tag.
 * 4. LICENSE_KEY_ENCRYPTION_KEY must be a 32-byte key (64 hex characters or 32 bytes).
 *    Zero source-code default: fails closed if missing or invalid.
 * 5. Safe display uses keyLast4 mask (e.g., NXS-****-...-A1B2).
 */

export interface EncryptedLicenseKey {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export const LICENSE_KEY_REGEX = /^NXS-(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/;

/**
 * Normalizes an incoming raw license key.
 * Trims whitespace, converts to uppercase.
 * Rejects empty, non-string, or malformed formats.
 * Enforces strict Phase 7 format: NXS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.
 */
export function normalizeLicenseKey(rawKey: string | null | undefined): string {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error("License key is required and must be a non-empty string");
  }

  const trimmed = rawKey.trim();
  if (!trimmed) {
    throw new Error("License key cannot be empty or whitespace only");
  }

  const upper = trimmed.toUpperCase();
  if (!LICENSE_KEY_REGEX.test(upper)) {
    throw new Error(
      "Invalid license key format: key must match NXS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX",
    );
  }

  return upper;
}

/**
 * Generates a cryptographically secure, high-entropy license key.
 * Uses 16 random bytes (128-bit cryptographic entropy).
 * Formatted as: NXS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (8 chunks of 4 hex chars).
 */
export function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(16);
  const hex = bytes.toString("hex").toUpperCase(); // 32 characters
  const chunks: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    chunks.push(hex.substring(i, i + 4));
  }
  return `NXS-${chunks.join("-")}`;
}

/**
 * Computes SHA-256 hash of normalized license key for database lookup.
 */
export function hashLicenseKey(licenseKey: string): string {
  const normalized = normalizeLicenseKey(licenseKey);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Extracts the last 4 alphanumeric characters of a license key.
 */
export function extractKeyLast4(licenseKey: string): string {
  const normalized = normalizeLicenseKey(licenseKey);
  const cleaned = normalized.replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(-4);
}

/**
 * Generates a masked display representation of a license key.
 * E.g., NXS-****-****-****-****-****-****-****-A1B2
 */
export function maskLicenseKey(licenseKey: string): string {
  const last4 = extractKeyLast4(licenseKey);
  return `NXS-****-****-****-****-****-****-****-${last4}`;
}

/**
 * Resolves and validates the 32-byte AES-256 encryption key.
 * Strictly requires 32 bytes (64 hex characters or 32 raw bytes).
 * Fails closed with NO source-code default.
 */
export function getEncryptionKey(overrideKey?: string): Buffer {
  const keyStr = overrideKey || process.env.LICENSE_KEY_ENCRYPTION_KEY;
  if (!keyStr || typeof keyStr !== "string" || keyStr.trim() === "") {
    throw new Error(
      "LICENSE_KEY_ENCRYPTION_KEY is required and must be a 32-byte key (64 hex characters or 32-byte buffer). No source-code default permitted.",
    );
  }

  const trimmed = keyStr.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const buf = Buffer.from(trimmed, "utf8");
  if (buf.length === 32) {
    return buf;
  }

  throw new Error(
    `LICENSE_KEY_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters or 32 raw bytes). Provided length: ${trimmed.length}`,
  );
}

/**
 * Encrypts a plaintext license key using AES-256-GCM.
 * Generates a fresh random 12-byte IV for every encryption.
 */
export function encryptLicenseKey(
  plaintext: string,
  secretKey?: string,
): EncryptedLicenseKey {
  const normalized = normalizeLicenseKey(plaintext);
  const key = getEncryptionKey(secretKey);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let ciphertext = cipher.update(normalized, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    ciphertext,
    iv: iv.toString("hex"),
    authTag,
  };
}

/**
 * Decrypts an encrypted license key using AES-256-GCM.
 * Verifies the authentication tag; fails closed on tampering or wrong key.
 */
export function decryptLicenseKey(
  ciphertext: string,
  iv: string,
  authTag: string,
  secretKey?: string,
): string {
  const key = getEncryptionKey(secretKey);
  try {
    const ivBuffer = Buffer.from(iv, "hex");
    const authTagBuffer = Buffer.from(authTag, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuffer);
    decipher.setAuthTag(authTagBuffer);

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err: any) {
    throw new Error(
      `License key decryption failed: invalid key, tampered ciphertext, or invalid authentication tag`,
    );
  }
}
