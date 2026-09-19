import {
  resolveN8nWebhookUrl,
  resolveWebhookUrlForJobType,
  resolveAutomationServiceSecret,
  dispatchSingleAutomationJob,
  dispatchPendingAutomationJobs,
  sanitizeErrorMessage,
} from "./automation-dispatcher";
import {
  prisma,
  AutomationJobStatus,
  AutomationJobType,
  AutomationDeliveryStatus,
} from "@nexus/database";
import { verifyAutomationSignature } from "@nexus/utils";

describe("Automation Dispatcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("resolveN8nWebhookUrl & multi-route dispatch", () => {
    it("returns null when webhook URLs are not set in development", () => {
      delete process.env.N8N_AUTOMATION_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_BASE_URL;
      delete process.env.N8N_CMS_AI_DRAFT_WEBHOOK_URL;
      expect(resolveN8nWebhookUrl()).toBeNull();
      expect(resolveWebhookUrlForJobType("CMS_AI_DRAFT")).toBeNull();
    });

    it("resolves specific webhook URL for CMS_AI_DRAFT", () => {
      process.env.N8N_CMS_AI_DRAFT_WEBHOOK_URL = "http://localhost:5678/webhook/custom-cms";
      expect(resolveWebhookUrlForJobType("CMS_AI_DRAFT")).toBe(
        "http://localhost:5678/webhook/custom-cms",
      );
    });

    it("resolves from base URL when specific URL not set", () => {
      process.env.N8N_WEBHOOK_BASE_URL = "http://localhost:5678";
      expect(resolveWebhookUrlForJobType("ORDER_PAID_EMAIL")).toBe(
        "http://localhost:5678/webhook/order-paid-email",
      );
      expect(resolveWebhookUrlForJobType("LICENSE_PROVISIONED_EMAIL")).toBe(
        "http://localhost:5678/webhook/license-provisioned-email",
      );
    });

    it("fails closed in production if webhook URL is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.N8N_AUTOMATION_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_BASE_URL;
      delete process.env.N8N_CMS_AI_DRAFT_WEBHOOK_URL;
      expect(() => resolveWebhookUrlForJobType("CMS_AI_DRAFT")).toThrow(
        /Missing required automation webhook URL/,
      );
    });

    it("rejects localhost URL in production", () => {
      process.env.NODE_ENV = "production";
      process.env.N8N_CMS_AI_DRAFT_WEBHOOK_URL = "http://localhost:5678/webhook/cms";
      expect(() => resolveWebhookUrlForJobType("CMS_AI_DRAFT")).toThrow(
        /Insecure automation webhook URL/,
      );
    });
  });

  describe("resolveAutomationServiceSecret", () => {
    it("returns secret when configured", () => {
      process.env.AUTOMATION_SERVICE_SECRET = "super-secret-automation-key-32chars";
      expect(resolveAutomationServiceSecret()).toBe("super-secret-automation-key-32chars");
    });

    it("fails closed in production when secret is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.AUTOMATION_SERVICE_SECRET;
      expect(() => resolveAutomationServiceSecret()).toThrow(
        /Missing required AUTOMATION_SERVICE_SECRET/,
      );
    });

    it("fails closed in production when secret is placeholder or too short", () => {
      process.env.NODE_ENV = "production";
      process.env.AUTOMATION_SERVICE_SECRET = "placeholder";
      expect(() => resolveAutomationServiceSecret()).toThrow(/Insecure AUTOMATION_SERVICE_SECRET/);

      process.env.AUTOMATION_SERVICE_SECRET = "short-key";
      expect(() => resolveAutomationServiceSecret()).toThrow(/Insecure AUTOMATION_SERVICE_SECRET/);
    });
  });

  describe("dispatchSingleAutomationJob", () => {
    const job = {
      id: "job-disp-1",
      type: AutomationJobType.ORDER_PAID_EMAIL,
      status: AutomationJobStatus.RUNNING,
      idempotencyKey: "key-1",
      payloadJson: { orderId: "ord-1", deliveryId: "del-1" },
      attemptCount: 1,
      maxAttempts: 3,
    };

    it("dispatches with worker identity in signature and updates delivery to SENDING", async () => {
      const secret = "test-secret-32-characters-minimum-entropy";
      let capturedHeaders: any;
      let capturedBody: any;

      global.fetch = jest.fn().mockImplementation((_url, init) => {
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body);
        return Promise.resolve({
          ok: true,
          status: 200,
        });
      });

      const deliveryUpdateSpy = jest
        .spyOn(prisma.automationDelivery, "update")
        .mockResolvedValue({ id: "del-1", status: "SENDING" } as any);

      const res = await dispatchSingleAutomationJob(
        job,
        "https://n8n.example.com/webhook/order-paid-email",
        secret,
      );

      expect(res.success).toBe(true);
      expect(deliveryUpdateSpy).toHaveBeenCalledWith({
        where: { id: "del-1" },
        data: { status: AutomationDeliveryStatus.SENDING },
      });

      expect(capturedHeaders["X-Nexus-Service"]).toBe("worker");
      expect(capturedHeaders["X-Nexus-Signature"]).toBeDefined();

      // Verify signature with worker service identity
      const verifyResult = verifyAutomationSignature({
        service: "worker",
        method: "POST",
        path: "/webhook/order-paid-email",
        timestamp: capturedHeaders["X-Nexus-Timestamp"],
        requestId: capturedHeaders["X-Nexus-Request-Id"],
        body: capturedBody,
        secret,
        signature: capturedHeaders["X-Nexus-Signature"],
      });

      expect(verifyResult.valid).toBe(true);
    });

    it("sanitizes error message when dispatch fails", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue("Error connecting to postgresql://user:pass@db:5432 with token=abc12345"),
      } as any);

      const res = await dispatchSingleAutomationJob(
        job,
        "https://n8n.example.com/webhook",
      );

      expect(res.success).toBe(false);
      expect(res.error).not.toContain("pass@");
      expect(res.error).not.toContain("token=abc12345");
      expect(res.error).toContain("retryable=true");
    });
  });

  describe("sanitizeErrorMessage", () => {
    it("redacts credentials, connection strings, and tokens", () => {
      const raw = "DB error at postgresql://admin:secret123@db.host.internal:5432/main with key=xyz789";
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).not.toContain("secret123");
      expect(sanitized).not.toContain("xyz789");
      expect(sanitized).toContain("***:***@");
      expect(sanitized).toContain("[REDACTED]");
    });
  });
});
