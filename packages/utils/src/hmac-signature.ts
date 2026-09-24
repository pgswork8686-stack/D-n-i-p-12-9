import * as crypto from "crypto";

export interface SignPayloadOptions {
  service: string;
  method: string;
  path: string;
  timestamp: string | number;
  requestId: string;
  body?: string | Buffer | object;
  secret: string;
}

export interface VerifySignatureOptions extends SignPayloadOptions {
  signature: string;
  maxSkewMs?: number;
  now?: number;
}

export interface VerifySignatureResult {
  valid: boolean;
  reason?: string;
}

export function computeSha256(data?: string | Buffer | object): string {
  if (data === undefined || data === null) {
    return crypto.createHash("sha256").update("").digest("hex");
  }
  let payloadStr: string;
  if (typeof data === "string") {
    payloadStr = data;
  } else if (Buffer.isBuffer(data)) {
    return crypto.createHash("sha256").update(data).digest("hex");
  } else {
    payloadStr = JSON.stringify(data);
  }
  return crypto.createHash("sha256").update(payloadStr, "utf8").digest("hex");
}

export function buildCanonicalString(
  service: string,
  method: string,
  path: string,
  timestamp: string | number,
  requestId: string,
  bodyHash: string,
): string {
  return [
    service,
    method.toUpperCase(),
    path,
    String(timestamp),
    requestId,
    bodyHash,
  ].join("\n");
}

export function signAutomationPayload(options: SignPayloadOptions): string {
  const { service, method, path, timestamp, requestId, body, secret } = options;
  if (!service) {
    throw new Error("Cannot sign payload: service is required");
  }
  if (!secret) {
    throw new Error("Cannot sign payload: secret is required");
  }
  const bodyHash = computeSha256(body);
  const canonical = buildCanonicalString(
    service,
    method,
    path,
    timestamp,
    requestId,
    bodyHash,
  );
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifyAutomationSignature(
  options: VerifySignatureOptions,
): VerifySignatureResult {
  const {
    service,
    method,
    path,
    timestamp,
    requestId,
    body,
    secret,
    signature,
    maxSkewMs = 5 * 60 * 1000, // 5 minutes
    now = Date.now(),
  } = options;

  if (!service || service.trim() === "") {
    return { valid: false, reason: "Missing service name" };
  }

  if (!secret || secret.trim() === "") {
    return { valid: false, reason: "Missing service secret" };
  }

  if (!signature || signature.trim() === "") {
    return { valid: false, reason: "Missing signature" };
  }

  if (!requestId || requestId.trim() === "") {
    return { valid: false, reason: "Missing request ID" };
  }

  // Validate timestamp format and clock skew
  const parsedTs =
    typeof timestamp === "number" ? timestamp : Number(timestamp) || Date.parse(timestamp);

  if (isNaN(parsedTs)) {
    return { valid: false, reason: "Invalid timestamp format" };
  }

  const skew = Math.abs(now - parsedTs);
  if (skew > maxSkewMs) {
    return { valid: false, reason: `Timestamp skew exceeded (${skew}ms > ${maxSkewMs}ms)` };
  }

  let expectedSignature: string;
  try {
    expectedSignature = signAutomationPayload({
      service,
      method,
      path,
      timestamp,
      requestId,
      body,
      secret,
    });
  } catch (err: any) {
    return { valid: false, reason: err.message };
  }

  // Timing-safe comparison
  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expectedSignature, "hex");

  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false, reason: "Signature mismatch" };
  }

  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: "Signature mismatch" };
  }

  return { valid: true };
}
