import {
  generateLicenseKey,
  normalizeLicenseKey,
  hashLicenseKey,
  extractKeyLast4,
  maskLicenseKey,
  getEncryptionKey,
  encryptLicenseKey,
  decryptLicenseKey,
} from "./license-crypto";

describe("License Crypto Utilities", () => {
  const TEST_KEY_HEX =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32 bytes
  const WRONG_KEY_HEX =
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

  beforeAll(() => {
    process.env.LICENSE_KEY_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  describe("generateLicenseKey", () => {
    it("should generate a high-entropy key formatted with NXS- and 8 chunks of 4 characters", () => {
      const key = generateLicenseKey();
      expect(key).toMatch(/^NXS-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    });

    it("should produce distinct keys on consecutive invocations", () => {
      const key1 = generateLicenseKey();
      const key2 = generateLicenseKey();
      expect(key1).not.toEqual(key2);
    });
  });

  describe("normalizeLicenseKey", () => {
    it("should trim and uppercase valid license keys", () => {
      const key = "  nxs-1234-abcd-5678-ef90-1111-2222-3333-4444  ";
      expect(normalizeLicenseKey(key)).toBe(
        "NXS-1234-ABCD-5678-EF90-1111-2222-3333-4444",
      );
    });

    it("should reject empty or null inputs", () => {
      expect(() => normalizeLicenseKey("")).toThrow("License key is required");
      expect(() => normalizeLicenseKey(null as any)).toThrow("License key is required");
      expect(() => normalizeLicenseKey(undefined as any)).toThrow("License key is required");
      expect(() => normalizeLicenseKey("   ")).toThrow("cannot be empty");
    });

    it("should reject keys without NXS- prefix", () => {
      expect(() => normalizeLicenseKey("ABCD-1234")).toThrow(
        "key must begin with 'NXS-'",
      );
    });
  });

  describe("hashLicenseKey", () => {
    it("should produce deterministic SHA-256 hash", () => {
      const key = "NXS-1234-ABCD-5678-EF90-1111-2222-3333-4444";
      const hash1 = hashLicenseKey(key);
      const hash2 = hashLicenseKey(key.toLowerCase());
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe("extractKeyLast4 & maskLicenseKey", () => {
    it("should extract last 4 characters and format masked string", () => {
      const key = "NXS-1111-2222-3333-4444-5555-6666-7777-8899";
      expect(extractKeyLast4(key)).toBe("8899");
      expect(maskLicenseKey(key)).toBe(
        "NXS-****-****-****-****-****-****-****-8899",
      );
    });
  });

  describe("getEncryptionKey", () => {
    it("should parse 64 hex characters into 32-byte Buffer", () => {
      const keyBuf = getEncryptionKey(TEST_KEY_HEX);
      expect(keyBuf.length).toBe(32);
    });

    it("should parse 32-character utf-8 string into 32-byte Buffer", () => {
      const keyBuf = getEncryptionKey("12345678901234567890123456789012");
      expect(keyBuf.length).toBe(32);
    });

    it("should fail closed if key is missing and no environment variable", () => {
      const orig = process.env.LICENSE_KEY_ENCRYPTION_KEY;
      try {
        delete process.env.LICENSE_KEY_ENCRYPTION_KEY;
        expect(() => getEncryptionKey()).toThrow(
          "LICENSE_KEY_ENCRYPTION_KEY is required",
        );
      } finally {
        process.env.LICENSE_KEY_ENCRYPTION_KEY = orig;
      }
    });

    it("should fail closed if key has invalid length", () => {
      expect(() => getEncryptionKey("too-short")).toThrow(
        "must be exactly 32 bytes",
      );
    });
  });

  describe("encryptLicenseKey & decryptLicenseKey", () => {
    it("should successfully encrypt and decrypt a license key", () => {
      const plaintext = generateLicenseKey();
      const encrypted = encryptLicenseKey(plaintext, TEST_KEY_HEX);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.authTag).toHaveLength(32); // 16 bytes = 32 hex chars

      const decrypted = decryptLicenseKey(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        TEST_KEY_HEX,
      );
      expect(decrypted).toBe(plaintext);
    });

    it("should generate distinct ciphertexts and IVs for identical plaintexts", () => {
      const plaintext = generateLicenseKey();
      const enc1 = encryptLicenseKey(plaintext, TEST_KEY_HEX);
      const enc2 = encryptLicenseKey(plaintext, TEST_KEY_HEX);

      expect(enc1.iv).not.toEqual(enc2.iv);
      expect(enc1.ciphertext).not.toEqual(enc2.ciphertext);
    });

    it("should fail closed when decrypted with wrong key", () => {
      const plaintext = generateLicenseKey();
      const encrypted = encryptLicenseKey(plaintext, TEST_KEY_HEX);

      expect(() =>
        decryptLicenseKey(
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          WRONG_KEY_HEX,
        ),
      ).toThrow("License key decryption failed");
    });

    it("should fail closed when ciphertext is tampered", () => {
      const plaintext = generateLicenseKey();
      const encrypted = encryptLicenseKey(plaintext, TEST_KEY_HEX);

      // Flip one character in ciphertext
      const tamperedCiphertext =
        encrypted.ciphertext[0] === "a"
          ? "b" + encrypted.ciphertext.slice(1)
          : "a" + encrypted.ciphertext.slice(1);

      expect(() =>
        decryptLicenseKey(
          tamperedCiphertext,
          encrypted.iv,
          encrypted.authTag,
          TEST_KEY_HEX,
        ),
      ).toThrow("License key decryption failed");
    });

    it("should fail closed when authTag is tampered", () => {
      const plaintext = generateLicenseKey();
      const encrypted = encryptLicenseKey(plaintext, TEST_KEY_HEX);

      const tamperedAuthTag =
        encrypted.authTag[0] === "0"
          ? "1" + encrypted.authTag.slice(1)
          : "0" + encrypted.authTag.slice(1);

      expect(() =>
        decryptLicenseKey(
          encrypted.ciphertext,
          encrypted.iv,
          tamperedAuthTag,
          TEST_KEY_HEX,
        ),
      ).toThrow("License key decryption failed");
    });
  });
});
