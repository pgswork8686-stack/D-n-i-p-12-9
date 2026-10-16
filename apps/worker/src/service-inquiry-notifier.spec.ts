import { prisma } from "@nexus/database";
import {
  DEFAULT_HOURLY_EMAIL_CAP,
  loadNotifierConfig,
  processServiceInquiryCreatedEvent,
} from "./service-inquiry-notifier";

const inquiry = {
  id: "inq-1",
  inquiryNumber: "SI-202610-ABCDEF",
  companyName: "Công ty ABC",
  service: { name: "AI Chatbot" },
};
const payload = { inquiryId: "inq-1", inquiryNumber: "SI-202610-ABCDEF", serviceId: "svc-1", serviceName: "AI Chatbot" };

const cfg = (over: Partial<ReturnType<typeof loadNotifierConfig>> = {}) => ({
  ...loadNotifierConfig({}),
  ...over,
});

function arrange(opts: { staff?: string[]; existingNotified?: string[]; recentJobs?: number; existingKeys?: string[]; audited?: boolean } = {}) {
  jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiry as any);
  jest.spyOn(prisma.user, "findMany").mockResolvedValue((opts.staff ?? ["staff-1", "staff-2"]).map((id) => ({ id })) as any);
  jest.spyOn(prisma.notification, "findMany").mockResolvedValue((opts.existingNotified ?? []).map((userId) => ({ userId })) as any);
  const createMany = jest
    .spyOn(prisma.notification, "createMany")
    .mockImplementation((async (args: any) => ({ count: args.data.length })) as any);
  jest.spyOn(prisma.automationJob, "count").mockResolvedValue(opts.recentJobs ?? 0);
  jest
    .spyOn(prisma.automationJob, "findUnique")
    .mockImplementation((async (args: any) => (opts.existingKeys?.includes(args.where.idempotencyKey) ? { id: "job-x" } : null)) as any);
  const delivery = jest.spyOn(prisma.automationDelivery, "create").mockResolvedValue({ id: "del-1" } as any);
  jest.spyOn(prisma.automationDelivery, "update").mockResolvedValue({} as any);
  const job = jest.spyOn(prisma.automationJob, "create").mockResolvedValue({ id: "job-1" } as any);
  jest.spyOn(prisma, "$transaction").mockImplementation((async (cb: any) => cb(prisma)) as any);
  jest.spyOn(prisma.auditLog, "findFirst").mockResolvedValue((opts.audited ? { id: "a" } : null) as any);
  const audit = jest.spyOn(prisma.auditLog, "create").mockResolvedValue({} as any);
  return { createMany, job, delivery, audit };
}

describe("loadNotifierConfig", () => {
  it("has email disabled by default: no hardcoded recipient", () => {
    const c = loadNotifierConfig({});
    expect(c.emails).toEqual([]);
    expect(c.adminBaseUrl).toBeNull();
    expect(c.hourlyEmailCap).toBe(DEFAULT_HOURLY_EMAIL_CAP);
  });

  it("parses, lower-cases, de-duplicates and bounds the mailbox list; counts invalid entries", () => {
    const c = loadNotifierConfig({
      SERVICE_INQUIRY_NOTIFY_EMAILS: "Sales@Example.com, sales@example.com; bad-address ops@example.com",
      SERVICE_INQUIRY_NOTIFY_MAX_EMAILS: "2",
    });
    expect(c.emails).toEqual(["sales@example.com", "ops@example.com"]);
    expect(c.invalidEmails).toBe(1);
  });

  it("only accepts an http(s) admin origin and strips any path", () => {
    expect(loadNotifierConfig({ ADMIN_PUBLIC_URL: "https://admin.example.com/x/y" }).adminBaseUrl).toBe("https://admin.example.com");
    expect(loadNotifierConfig({ ADMIN_PUBLIC_URL: "javascript:alert(1)" }).adminBaseUrl).toBeNull();
  });
});

describe("processServiceInquiryCreatedEvent", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("notifies staff in-app and writes one audit row, even with email unconfigured", async () => {
    const { createMany, job, audit } = arrange();
    const res = await processServiceInquiryCreatedEvent(payload, "w1", cfg());
    expect(res).toMatchObject({ handled: true, staffNotified: 2, emailJobsQueued: 0 });
    const rows = (createMany.mock.calls[0][0] as any).data as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: "SERVICE_INQUIRY_CREATED",
      actionUrl: "/service-inquiries/inq-1",
      metadata: { inquiryId: "inq-1", inquiryNumber: "SI-202610-ABCDEF" },
    });
    expect(job).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect((audit.mock.calls[0][0] as any).data.details).toMatchObject({ staffNotified: 2, emailConfigured: false });
  });

  it("is idempotent: a re-run creates no second notification, email job or audit row", async () => {
    const hash = (await import("crypto")).createHash("sha256").update("sales@example.com").digest("hex").slice(0, 16);
    const { createMany, job, audit } = arrange({
      existingNotified: ["staff-1", "staff-2"],
      existingKeys: [`service-inquiry-notify:inq-1:${hash}`],
      audited: true,
    });
    const res = await processServiceInquiryCreatedEvent(payload, "w1", cfg({ emails: ["sales@example.com"] }));
    expect(res).toMatchObject({ staffNotified: 0, emailJobsQueued: 0 });
    expect(createMany).not.toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("queues one email job per configured mailbox with a minimal payload (no contact data or requirements)", async () => {
    const { job, delivery } = arrange();
    const res = await processServiceInquiryCreatedEvent(
      payload,
      "w1",
      cfg({ emails: ["sales@example.com", "ops@example.com"], adminBaseUrl: "https://admin.example.com" }),
    );
    expect(res.emailJobsQueued).toBe(2);
    const first = (job.mock.calls[0][0] as any).data;
    expect(first.type).toBe("SERVICE_INQUIRY_NOTIFY_EMAIL");
    expect(first.idempotencyKey).toMatch(/^service-inquiry-notify:inq-1:[a-f0-9]{16}$/);
    expect(first.payloadJson).toMatchObject({
      recipientEmail: "sales@example.com",
      inquiryNumber: "SI-202610-ABCDEF",
      serviceName: "AI Chatbot",
      adminUrl: "https://admin.example.com/service-inquiries/inq-1",
    });
    expect(Object.keys(first.payloadJson).sort()).toEqual(
      ["adminUrl", "companyName", "deliveryId", "inquiryNumber", "providerIdempotencyKey", "recipientEmail", "serviceName"].sort(),
    );
    expect(delivery).toHaveBeenCalledTimes(2);
  });

  it("caps email per hour but still sends the in-app notices", async () => {
    const { createMany, job, audit } = arrange({ recentJobs: DEFAULT_HOURLY_EMAIL_CAP });
    const res = await processServiceInquiryCreatedEvent(payload, "w1", cfg({ emails: ["sales@example.com"] }));
    expect(res).toMatchObject({ staffNotified: 2, emailJobsQueued: 0, emailSuppressedByCap: true });
    expect(createMany).toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
    expect((audit.mock.calls[0][0] as any).data.details.emailSuppressedByCap).toBe(true);
  });

  it("treats a concurrent duplicate job as success (unique violation) instead of retrying forever", async () => {
    arrange();
    const { Prisma } = await import("@nexus/database");
    jest.spyOn(prisma.automationJob, "create").mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }));
    const res = await processServiceInquiryCreatedEvent(payload, "w1", cfg({ emails: ["sales@example.com"] }));
    expect(res.emailJobsQueued).toBe(0);
  });

  it("lets real queue errors propagate so the outbox retries with back-off; in-app notices were already sent", async () => {
    const { createMany } = arrange();
    jest.spyOn(prisma.automationJob, "create").mockRejectedValue(new Error("db down"));
    await expect(processServiceInquiryCreatedEvent(payload, "w1", cfg({ emails: ["sales@example.com"] }))).rejects.toThrow("db down");
    expect(createMany).toHaveBeenCalled();
  });

  it("skips (does not retry) when the inquiry no longer exists", async () => {
    jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(null);
    const res = await processServiceInquiryCreatedEvent(payload, "w1", cfg());
    expect(res).toMatchObject({ handled: true, skipped: "INQUIRY_NOT_FOUND" });
  });

  it("rejects a payload without inquiryId", async () => {
    await expect(processServiceInquiryCreatedEvent({}, "w1", cfg())).rejects.toThrow(/inquiryId/);
  });

  it("only targets accounts allowed to read inquiries (super_admin or inquiry.read), capped", async () => {
    arrange();
    const find = jest.spyOn(prisma.user, "findMany");
    await processServiceInquiryCreatedEvent(payload, "w1", cfg({ maxStaff: 7 }));
    const args = find.mock.calls[0][0] as any;
    expect(args.take).toBe(7);
    expect(JSON.stringify(args.where)).toContain("inquiry.read");
    expect(JSON.stringify(args.where)).toContain("super_admin");
  });
});
