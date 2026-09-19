import {
  signAutomationPayload,
  verifyAutomationSignature,
  computeSha256,
} from "./hmac-signature";

describe("HMAC Signature Utility", () => {
  const secret = "test-automation-secret-1234567890";
  const fixedNow = 1700000000000;
  const service = "n8n";

  it("computes SHA256 of empty/undefined body correctly", () => {
    const emptyHash = computeSha256();
    expect(emptyHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("signs and verifies a valid payload successfully", () => {
    const payload = { jobId: "job-123", result: "ok" };
    const sig = signAutomationPayload({
      service,
      method: "POST",
      path: "/v1/internal/automation/jobs/job-123/complete",
      timestamp: fixedNow,
      requestId: "req-001",
      body: payload,
      secret,
    });

    expect(sig).toHaveLength(64);

    const result = verifyAutomationSignature({
      service,
      method: "POST",
      path: "/v1/internal/automation/jobs/job-123/complete",
      timestamp: fixedNow,
      requestId: "req-001",
      body: payload,
      secret,
      signature: sig,
      now: fixedNow,
    });

    expect(result.valid).toBe(true);
  });

  it("rejects when service name is tampered", () => {
    const payload = { jobId: "job-123" };
    const sig = signAutomationPayload({
      service: "worker",
      method: "POST",
      path: "/v1/internal/automation/jobs/job-123/complete",
      timestamp: fixedNow,
      requestId: "req-tamper-srv",
      body: payload,
      secret,
    });

    const result = verifyAutomationSignature({
      service: "n8n", // Tampered service
      method: "POST",
      path: "/v1/internal/automation/jobs/job-123/complete",
      timestamp: fixedNow,
      requestId: "req-tamper-srv",
      body: payload,
      secret,
      signature: sig,
      now: fixedNow,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Signature mismatch");
  });

  it("rejects when timestamp skew exceeds maximum skew", () => {
    const payload = { test: true };
    const oldTimestamp = fixedNow - 10 * 60 * 1000; // 10 minutes ago
    const sig = signAutomationPayload({
      service,
      method: "POST",
      path: "/v1/internal/test",
      timestamp: oldTimestamp,
      requestId: "req-002",
      body: payload,
      secret,
    });

    const result = verifyAutomationSignature({
      service,
      method: "POST",
      path: "/v1/internal/test",
      timestamp: oldTimestamp,
      requestId: "req-002",
      body: payload,
      secret,
      signature: sig,
      now: fixedNow,
      maxSkewMs: 5 * 60 * 1000, // 5 min
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Timestamp skew exceeded");
  });

  it("rejects tampered body", () => {
    const sig = signAutomationPayload({
      service,
      method: "POST",
      path: "/v1/internal/test",
      timestamp: fixedNow,
      requestId: "req-003",
      body: { amount: 100 },
      secret,
    });

    const result = verifyAutomationSignature({
      service,
      method: "POST",
      path: "/v1/internal/test",
      timestamp: fixedNow,
      requestId: "req-003",
      body: { amount: 999 }, // Tampered
      secret,
      signature: sig,
      now: fixedNow,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Signature mismatch");
  });

  it("rejects missing or empty secret", () => {
    const result = verifyAutomationSignature({
      service,
      method: "POST",
      path: "/v1/internal/test",
      timestamp: fixedNow,
      requestId: "req-004",
      body: {},
      secret: "",
      signature: "abc",
      now: fixedNow,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing service secret");
  });

  it("rejects missing service", () => {
    const result = verifyAutomationSignature({
      service: "",
      method: "POST",
      path: "/v1/internal/test",
      timestamp: fixedNow,
      requestId: "req-missing-svc",
      body: {},
      secret,
      signature: "abc",
      now: fixedNow,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing service name");
  });

  it("rejects tampered HTTP method or path", () => {
    const sig = signAutomationPayload({
      service,
      method: "POST",
      path: "/v1/internal/test",
      timestamp: fixedNow,
      requestId: "req-005",
      body: {},
      secret,
    });

    const result = verifyAutomationSignature({
      service,
      method: "GET", // Tampered method
      path: "/v1/internal/test",
      timestamp: fixedNow,
      requestId: "req-005",
      body: {},
      secret,
      signature: sig,
      now: fixedNow,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Signature mismatch");
  });
});
