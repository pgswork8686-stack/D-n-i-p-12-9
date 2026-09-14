/**
 * Authoritative Domain Normalizer and Validator for Phase 6.
 *
 * Normalizes input domain strings:
 * - Strips protocols (http, https, etc.)
 * - Strips user authentication, port, path, query parameters, and fragments
 * - Converts to lowercase and strips trailing dot
 * - Converts internationalized domains (IDN) deterministically to ASCII punycode
 * - Normalizes 'www.' prefix for root/subdomains
 *
 * Rejects:
 * - Empty or whitespace-only inputs
 * - Wildcard domains (*.example.com, *)
 * - Protocol-only inputs (http://, https://)
 * - Paths without hostname (/path, http:///foo)
 * - Localhost or .localhost domains
 * - Raw IPv4 and IPv6 addresses
 * - Invalid characters, invalid label syntax, or single-word domains without TLD
 */

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const TLD_REGEX = /^[a-z]{2,}$|^xn--[a-z0-9]+$/;

export function normalizeDomain(rawInput: string | null | undefined): string {
  if (!rawInput || typeof rawInput !== "string") {
    throw new Error("Domain is required and must be a non-empty string");
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Domain cannot be empty or whitespace only");
  }

  // Reject wildcards early
  if (trimmed.includes("*")) {
    throw new Error("Wildcard domains are not permitted");
  }

  // Reject protocol-only values
  if (/^https?:\/\/?$/i.test(trimmed)) {
    throw new Error("Invalid domain: missing hostname in protocol URL");
  }

  // Reject relative paths without scheme/host
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error("Invalid domain: path without hostname");
  }

  // Parse hostname using Node's standard URL parser
  let urlToParse = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    urlToParse = `http://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlToParse);
  } catch {
    throw new Error(`Invalid domain format: unable to parse '${trimmed}'`);
  }

  // Reject URL credentials (username or password in userinfo)
  if (parsed.username || parsed.password) {
    throw new Error("URL credentials (username/password) are not permitted in domain names");
  }

  let hostname = parsed.hostname;
  if (!hostname || hostname.trim() === "") {
    throw new Error("Invalid domain: missing hostname");
  }

  // Normalize: lowercase & strip trailing dot
  hostname = hostname.toLowerCase();
  if (hostname.endsWith(".")) {
    hostname = hostname.slice(0, -1);
  }

  if (!hostname) {
    throw new Error("Invalid domain: empty hostname");
  }

  // Reject localhost
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost domains are not permitted");
  }

  // Reject IPv6 (bracketed or containing colons)
  if (hostname.startsWith("[") || hostname.endsWith("]") || hostname.includes(":")) {
    throw new Error("IPv6 addresses are not permitted as license domains");
  }

  // Reject IPv4
  const ipv4Match = hostname.match(IPV4_REGEX);
  if (ipv4Match) {
    const octets = [
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    ];
    if (octets.every((o) => o >= 0 && o <= 255)) {
      throw new Error("Raw IPv4 addresses are not permitted as license domains");
    }
  }

  // Normalize www prefix: www.example.com -> example.com
  // Only strip www. if there's a dot remaining in the domain (i.e. not www.com)
  if (hostname.startsWith("www.")) {
    const withoutWww = hostname.slice(4);
    if (withoutWww.includes(".")) {
      hostname = withoutWww;
    }
  }

  // Check overall domain length (RFC 1035 max is 253 characters)
  if (hostname.length > 253) {
    throw new Error("Domain name exceeds maximum length of 253 characters");
  }

  // Validate domain structure and labels
  const labels = hostname.split(".");
  if (labels.length < 2) {
    throw new Error(
      `Invalid domain structure: '${hostname}' must have a valid domain and top-level domain (TLD)`,
    );
  }

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!label || label.length === 0) {
      throw new Error("Invalid domain: contains empty label (e.g. consecutive dots)");
    }
    if (label.length > 63) {
      throw new Error(`Domain label '${label}' exceeds maximum length of 63 characters`);
    }
    if (!LABEL_REGEX.test(label)) {
      throw new Error(
        `Domain label '${label}' contains invalid characters or starts/ends with a hyphen`,
      );
    }
  }

  // Validate TLD (last label)
  const tld = labels[labels.length - 1];
  if (!TLD_REGEX.test(tld)) {
    throw new Error(
      `Invalid top-level domain '${tld}': TLD must be at least 2 alphabetical characters or valid punycode`,
    );
  }

  return hostname;
}

export function isValidDomain(input: string | null | undefined): boolean {
  try {
    normalizeDomain(input);
    return true;
  } catch {
    return false;
  }
}
