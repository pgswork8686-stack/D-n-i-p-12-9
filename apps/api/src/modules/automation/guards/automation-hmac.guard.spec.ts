import {
  ExecutionContext,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AutomationHmacGuard } from "./automation-hmac.guard";
import { signAutomationPayload } from "@nexus/utils";

describe("AutomationHmacGuard", () => {
  let guard: AutomationHmacGuard;
  let mockRedis: any;
  const testSecret = "super-secret-automation-key-32chars-long";

  beforeEach(() => {
    const memoryStore = new Map<string, string>();
    mockRedis = {
      set: jest.fn().mockImplementation((key: string, val: string, _px: string, _ttl: number, _nx: string) => {
        if (memoryStore.has(key)) {
          return Promise.resolve(null);
        }
        memoryStore.set(key, val);
        return Promise.resolve("OK");
      }),
      quit: jest.fn().mockResolvedValue("OK"),
    };

    guard = new AutomationHmacGuard(undefined, mockRedis);
    process.env.AUTOMATION_SERVICE_SECRET = testSecret;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    delete process.env.AUTOMATION_SERVICE_SECRET;
  });

  function createMockContext(
    headers: Record<string, string>,
    body: any = {},
    method = "POST",
    url = "/v1/internal/automation/jobs/123/complete",
  ) {
    const req = {
      headers,
      body,
      method,
      url,
      originalUrl: url,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  it("rejects when X-Nexus-Service header is missing", async () => {
    const ctx = createMockContext({
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-1",
      "x-nexus-signature": "sig",
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Service header is not n8n", async () => {
    const ctx = createMockContext({
      "x-nexus-service": "worker",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-wrong-service",
      "x-nexus-signature": "sig",
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Timestamp header is missing", async () => {
    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-request-id": "req-2",
      "x-nexus-signature": "sig",
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Request-Id header is missing", async () => {
    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-signature": "sig",
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Signature header is missing", async () => {
    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-3",
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects request when timestamp skew is older than 5 minutes", async () => {
    const oldTs = (Date.now() - 10 * 60 * 1000).toString();
    const body = { done: true };
    const sig = signAutomationPayload({
      service: "n8n",
      method: "POST",
      path: "/v1/internal/automation/jobs/123/complete",
      timestamp: oldTs,
      requestId: "req-skew",
      body,
      secret: testSecret,
    });

    const ctx = createMockContext(
      {
        "x-nexus-service": "n8n",
        "x-nexus-timestamp": oldTs,
        "x-nexus-request-id": "req-skew",
        "x-nexus-signature": sig,
      },
      body,
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("allows valid signed request and records in Redis", async () => {
    const now = Date.now().toString();
    const body = { result: "success" };
    const path = "/v1/internal/automation/jobs/123/complete";
    const sig = signAutomationPayload({
      service: "n8n",
      method: "POST",
      path,
      timestamp: now,
      requestId: "req-valid-1",
      body,
      secret: testSecret,
    });

    const ctx = createMockContext(
      {
        "x-nexus-service": "n8n",
        "x-nexus-timestamp": now,
        "x-nexus-request-id": "req-valid-1",
        "x-nexus-signature": sig,
      },
      body,
      "POST",
      path,
    );

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      "automation:hmac:replay:n8n:req-valid-1",
      "1",
      "PX",
      600000,
      "NX",
    );
  });

  it("rejects replay attack with identical request ID (409 Conflict)", async () => {
    const now = Date.now().toString();
    const body = { result: "success" };
    const path = "/v1/internal/automation/jobs/123/complete";
    const sig = signAutomationPayload({
      service: "n8n",
      method: "POST",
      path,
      timestamp: now,
      requestId: "req-replay-1",
      body,
      secret: testSecret,
    });

    const ctx1 = createMockContext(
      {
        "x-nexus-service": "n8n",
        "x-nexus-timestamp": now,
        "x-nexus-request-id": "req-replay-1",
        "x-nexus-signature": sig,
      },
      body,
      "POST",
      path,
    );

    expect(await guard.canActivate(ctx1)).toBe(true);

    // Second call with same requestId
    const ctx2 = createMockContext(
      {
        "x-nexus-service": "n8n",
        "x-nexus-timestamp": now,
        "x-nexus-request-id": "req-replay-1",
        "x-nexus-signature": sig,
      },
      body,
      "POST",
      path,
    );

    await expect(guard.canActivate(ctx2)).rejects.toThrow(ConflictException);
  });

  it("fails closed (503 Service Unavailable) when Redis is down", async () => {
    mockRedis.set = jest.fn().mockRejectedValue(new Error("Connection refused"));

    const now = Date.now().toString();
    const body = { result: "success" };
    const path = "/v1/internal/automation/jobs/123/complete";
    const sig = signAutomationPayload({
      service: "n8n",
      method: "POST",
      path,
      timestamp: now,
      requestId: "req-redis-down",
      body,
      secret: testSecret,
    });

    const ctx = createMockContext(
      {
        "x-nexus-service": "n8n",
        "x-nexus-timestamp": now,
        "x-nexus-request-id": "req-redis-down",
        "x-nexus-signature": sig,
      },
      body,
      "POST",
      path,
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("does not touch Redis if signature verification fails", async () => {
    const now = Date.now().toString();
    const body = { result: "tampered" };
    const path = "/v1/internal/automation/jobs/123/complete";

    const ctx = createMockContext(
      {
        "x-nexus-service": "n8n",
        "x-nexus-timestamp": now,
        "x-nexus-request-id": "req-bad-sig",
        "x-nexus-signature": "bad-signature-hex-1234567890abcdef1234567890abcdef",
      },
      body,
      "POST",
      path,
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("rejects placeholder secret in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AUTOMATION_SERVICE_SECRET = "placeholder";

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-prod-insecure",
      "x-nexus-signature": "some-sig",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects short secret (<32 chars) in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AUTOMATION_SERVICE_SECRET = "short-secret";

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-prod-short",
      "x-nexus-signature": "some-sig",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects whitespace-padded short secret in production (trimmed length < 32)", async () => {
    process.env.NODE_ENV = "production";
    // 10 chars surrounded by spaces making 35 chars total
    process.env.AUTOMATION_SERVICE_SECRET = "            short12345            ";

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-prod-padded",
      "x-nexus-signature": "some-sig",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects padded placeholder secret in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AUTOMATION_SERVICE_SECRET = "   changeme   ";

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-prod-padded-placeholder",
      "x-nexus-signature": "some-sig",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
