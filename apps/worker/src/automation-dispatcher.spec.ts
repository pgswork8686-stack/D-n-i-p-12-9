import {
  resolveN8nWebhookUrl,
  dispatchSingleAutomationJob,
  dispatchPendingAutomationJobs,
} from "./automation-dispatcher";
import {
  prisma,
  AutomationJobStatus,
  AutomationJobType,
} from "@nexus/database";

describe("Automation Dispatcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("resolveN8nWebhookUrl", () => {
    it("returns null when N8N_AUTOMATION_WEBHOOK_URL is not set", () => {
      delete process.env.N8N_AUTOMATION_WEBHOOK_URL;
      expect(resolveN8nWebhookUrl()).toBeNull();
    });

    it("allows localhost URL in development", () => {
      process.env.NODE_ENV = "development";
      process.env.N8N_AUTOMATION_WEBHOOK_URL = "http://localhost:5678/webhook/nexus";
      expect(resolveN8nWebhookUrl()).toBe("http://localhost:5678/webhook/nexus");
    });

    it("rejects localhost URL in production", () => {
      process.env.NODE_ENV = "production";
      process.env.N8N_AUTOMATION_WEBHOOK_URL = "http://localhost:5678/webhook/nexus";
      expect(() => resolveN8nWebhookUrl()).toThrow(/Insecure N8N_AUTOMATION_WEBHOOK_URL/);
    });

    it("rejects HTTP URL in production", () => {
      process.env.NODE_ENV = "production";
      process.env.N8N_AUTOMATION_WEBHOOK_URL = "http://n8n.example.com/webhook/nexus";
      expect(() => resolveN8nWebhookUrl()).toThrow(/Insecure N8N_AUTOMATION_WEBHOOK_URL/);
    });

    it("accepts valid HTTPS URL in production", () => {
      process.env.NODE_ENV = "production";
      process.env.N8N_AUTOMATION_WEBHOOK_URL = "https://n8n.example.com/webhook/nexus";
      expect(resolveN8nWebhookUrl()).toBe("https://n8n.example.com/webhook/nexus");
    });
  });

  describe("dispatchSingleAutomationJob", () => {
    const job = {
      id: "job-disp-1",
      type: AutomationJobType.ORDER_PAID_EMAIL,
      status: AutomationJobStatus.RUNNING,
      idempotencyKey: "key-1",
      payloadJson: { orderId: "ord-1" },
      attemptCount: 1,
      maxAttempts: 3,
    };

    it("returns success: true when webhook responds with 200", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as any);

      const res = await dispatchSingleAutomationJob(
        job,
        "https://n8n.example.com/webhook",
        "secret-key",
      );

      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://n8n.example.com/webhook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Nexus-Job-Id": "job-disp-1",
            "X-Nexus-Signature": expect.any(String),
          }),
        }),
      );
    });

    it("returns retryable error on 500 error", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue("Service Unavailable"),
      } as any);

      const res = await dispatchSingleAutomationJob(
        job,
        "https://n8n.example.com/webhook",
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("retryable=true");
    });
  });

  describe("dispatchPendingAutomationJobs", () => {
    it("returns zero counts when webhook URL is unconfigured", async () => {
      delete process.env.N8N_AUTOMATION_WEBHOOK_URL;
      const res = await dispatchPendingAutomationJobs();
      expect(res).toEqual({ claimedCount: 0, dispatchedCount: 0 });
    });
  });
});
