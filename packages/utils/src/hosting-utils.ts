import * as crypto from "crypto";

export type HostingDnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX"
  | "NS"
  | "SRV";

/**
 * Validates domain name syntax for hosting provisioning.
 * Must be a clean FQDN without protocols, paths, or ports.
 */
export function isValidHostingDomain(domain: string): boolean {
  if (!domain || typeof domain !== "string") return false;
  const trimmed = domain.trim().toLowerCase();
  if (
    trimmed.includes("://") ||
    trimmed.includes("/") ||
    trimmed.includes(":") ||
    trimmed.includes("?") ||
    trimmed.startsWith("-") ||
    trimmed.includes(".-") ||
    trimmed.includes("-.")
  ) {
    return false;
  }
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
  return domainRegex.test(trimmed);
}

/**
 * Generates a valid, sanitized cPanel/DirectAdmin hosting username.
 * Rules:
 * - Must start with a letter
 * - Lowercase alphanumeric only
 * - Length between 4 and 12 characters
 */
export function generateHostingUsername(domain: string, prefix = "nx"): string {
  if (!domain) return `${prefix}${Date.now().toString(36).slice(-4)}`;
  
  // Extract main domain part (e.g., example from example.com or sub.example.co.uk)
  const parts = domain.toLowerCase().replace(/[^a-z0-9.]/g, "").split(".");
  let mainPart = parts[0] || "site";
  if (parts.length > 2 && mainPart.length < 3) {
    mainPart = parts[1] || mainPart;
  }

  const sanitized = mainPart.replace(/[^a-z0-9]/g, "");
  const base = `${prefix}${sanitized}`.slice(0, 10);
  const suffix = Math.floor(100 + Math.random() * 900).toString();
  return `${base}${suffix}`.slice(0, 12);
}

/**
 * Validates DNS Record attributes based on record type.
 */
export function isValidDnsRecord(
  type: HostingDnsRecordType | string,
  name: string,
  content: string,
  priority?: number | null,
): { isValid: boolean; error?: string } {
  if (!name || typeof name !== "string") {
    return { isValid: false, error: "Record name cannot be empty" };
  }
  if (!content || typeof content !== "string") {
    return { isValid: false, error: "Record content cannot be empty" };
  }

  const trimmedName = name.trim();
  const trimmedContent = content.trim();

  // Validate name (@, *, or valid subdomain/domain label)
  if (trimmedName !== "@" && trimmedName !== "*") {
    const validNameRegex = /^([a-zA-Z0-9_-]+\.)*[a-zA-Z0-9_-]+$/;
    if (!validNameRegex.test(trimmedName)) {
      return { isValid: false, error: "Invalid DNS record name format" };
    }
  }

  switch (type) {
    case "A": {
      // IPv4 regex (0.0.0.0 to 255.255.255.255)
      const ipv4Regex =
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipv4Regex.test(trimmedContent)) {
        return { isValid: false, error: "Invalid IPv4 address for A record" };
      }
      break;
    }
    case "AAAA": {
      // Simplified IPv6 regex
      const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$/;
      if (!ipv6Regex.test(trimmedContent) && !trimmedContent.includes(":")) {
        return { isValid: false, error: "Invalid IPv6 address for AAAA record" };
      }
      break;
    }
    case "CNAME": {
      // Must be a valid hostname, cannot be raw IP
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmedContent)) {
        return { isValid: false, error: "CNAME content cannot be an IP address" };
      }
      if (trimmedName === "@") {
        return { isValid: false, error: "CNAME cannot be set on zone apex (@)" };
      }
      break;
    }
    case "TXT": {
      if (trimmedContent.length > 2048) {
        return { isValid: false, error: "TXT record content exceeds 2048 characters" };
      }
      break;
    }
    case "MX": {
      if (priority === undefined || priority === null || priority < 0 || priority > 65535) {
        return { isValid: false, error: "MX record requires a valid priority (0 - 65535)" };
      }
      break;
    }
    default:
      break;
  }

  return { isValid: true };
}

/**
 * Encrypts sensitive hosting credentials (API tokens, private keys)
 * using AES-256-GCM with a 12-byte random IV.
 */
export function encryptHostingCredential(
  plaintext: string,
  keyHex: string,
): { encrypted: string; iv: string; tag: string } {
  const key = Buffer.from(keyHex.padEnd(64, "0").slice(0, 64), "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return {
    encrypted,
    iv: iv.toString("hex"),
    tag,
  };
}

/**
 * Decrypts sensitive hosting credentials using AES-256-GCM.
 * Fails closed if ciphertext has been tampered with.
 */
export function decryptHostingCredential(
  encryptedHex: string,
  ivHex: string,
  tagHex: string,
  keyHex: string,
): string {
  const key = Buffer.from(keyHex.padEnd(64, "0").slice(0, 64), "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
