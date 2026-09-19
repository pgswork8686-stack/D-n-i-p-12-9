import { ExecutionContext, UnauthorizedException, ConflictException } from "@nestjs/common";
import { AutomationHmacGuard } from "./automation-hmac.guard";
import { signAutomationPayload } from "@nexus/utils";

describe("AutomationHmacGuard", () => {
  let guard: AutomationHmacGuard;
  const testSecret = "super-secret-automation-key-32chars";

  beforeEach(() => {
    guard = new AutomationHmacGuard();
    process.env.AUTOMATION_SERVICE_SECRET = testSecret;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    delete process.env.AUTOMATION_SERVICE_SECRET;
  });

  function createMockContext(headers: Record<string, string>, body: any = {}, method = "POST", url = "/v1/internal/automation/jobs/123/complete") {
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

  it("rejects when X-Nexus-Service header is missing", () => {
    const ctx = createMockContext({
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-1",
      "x-nexus-signature": "sig",
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Timestamp header is missing", () => {
    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-request-id": "req-2",
      "x-nexus-signature": "sig",
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Request-Id header is missing", () => {
    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-signature": "sig",
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when X-Nexus-Signature header is missing", () => {
    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-3",
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects request when timestamp skew is older than 5 minutes", () => {
    const oldTs = (Date.now() - 10 * 60 * 1000).toString();
    const body = { done: true };
    const sig = signAutomationPayload({
      method: "POST",
      path: "/v1/internal/automation/jobs/123/complete",
      timestamp: oldTs,
      requestId: "req-skew",
      body,
      secret: testSecret,
    });

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": oldTs,
      "x-nexus-request-id": "req-skew",
      "x-nexus-signature": sig,
    }, body);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("allows valid signed request", () => {
    const now = Date.now().toString();
    const body = { result: "success" };
    const path = "/v1/internal/automation/jobs/123/complete";
    const sig = signAutomationPayload({
      method: "POST",
      path,
      timestamp: now,
      requestId: "req-valid-1",
      body,
      secret: testSecret,
    });

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": now,
      "x-nexus-request-id": "req-valid-1",
      "x-nexus-signature": sig,
    }, body, "POST", path);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects replay attack with identical request ID", () => {
    const now = Date.now().toString();
    const body = { result: "success" };
    const path = "/v1/internal/automation/jobs/123/complete";
    const sig = signAutomationPayload({
      method: "POST",
      path,
      timestamp: now,
      requestId: "req-replay-1",
      body,
      secret: testSecret,
    });

    const ctx1 = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": now,
      "x-nexus-request-id": "req-replay-1",
      "x-nexus-signature": sig,
    }, body, "POST", path);

    expect(guard.canActivate(ctx1)).toBe(true);

    // Second call with same requestId
    const ctx2 = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": now,
      "x-nexus-request-id": "req-replay-1",
      "x-nexus-signature": sig,
    }, body, "POST", path);

    expect(() => guard.canActivate(ctx2)).toThrow(ConflictException);
  });

  it("rejects placeholder secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTOMATION_SERVICE_SECRET = "placeholder";

    const ctx = createMockContext({
      "x-nexus-service": "n8n",
      "x-nexus-timestamp": Date.now().toString(),
      "x-nexus-request-id": "req-prod-insecure",
      "x-nexus-signature": "some-sig",
    });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
