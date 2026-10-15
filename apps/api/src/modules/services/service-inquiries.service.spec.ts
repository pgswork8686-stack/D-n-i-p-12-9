import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { prisma, Prisma, ServiceInquiryStatus } from "@nexus/database";
import { ServiceInquiriesService } from "./service-inquiries.service";
import * as projectsModule from "./service-projects.service";

const PDF = Buffer.from("%PDF-1.7 test");

function makeService() {
  const audit = { logActionWithClient: jest.fn().mockResolvedValue(undefined) };
  const rateLimiter = { consumeForSubmission: jest.fn().mockResolvedValue(undefined) };
  const files = {
    uploadAll: jest.fn(async (_scope: string, ownerId: string, list: any[]) =>
      list.map((f, i) => ({ ...f, storageKey: `services/inquiries/${ownerId}/${i}.pdf` })),
    ),
    deleteObjects: jest.fn().mockResolvedValue(undefined),
    signedUrl: jest.fn().mockResolvedValue({ url: "https://signed", expiresInSeconds: 120 }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new ServiceInquiriesService(audit as any, rateLimiter as any, files as any, config as any);
  return { service, audit, rateLimiter, files };
}

const baseDto = {
  serviceSlug: "ai-chatbot-development",
  companyName: "Công ty ABC",
  contactName: "Nguyễn Văn A",
  contactEmail: "a@example.com",
  requirements: "Cần chatbot trả lời khách hàng",
};

const inquiryRow = (over: Record<string, unknown> = {}) => ({
  id: "inq-1",
  inquiryNumber: "SI-202610-AAAAAA",
  serviceId: "svc-1",
  userId: "cust-1",
  companyName: "Công ty ABC",
  contactName: "A",
  contactEmail: "a@example.com",
  contactPhone: null,
  requirements: "x",
  desiredFeatures: [],
  budgetRange: null,
  timeline: null,
  status: ServiceInquiryStatus.NEW,
  submissionKey: null,
  staffNote: null,
  reviewedById: null,
  reviewedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  service: { id: "svc-1", slug: "ai-chatbot-development", name: "AI Chatbot" },
  attachments: [],
  project: null,
  ...over,
});

describe("ServiceInquiriesService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  describe("submit", () => {
    it("discards honeypot submissions without touching the database or quota", async () => {
      const { service, rateLimiter } = makeService();
      const create = jest.spyOn(prisma.serviceInquiry, "create");
      const res = await service.submit({ ...baseDto, website: "http://spam" } as any, [], {});
      expect(res.inquiryNumber).toMatch(/^SI-/);
      expect(create).not.toHaveBeenCalled();
      expect(rateLimiter.consumeForSubmission).not.toHaveBeenCalled();
    });

    it("rejects attachments from anonymous visitors", async () => {
      const { service } = makeService();
      await expect(
        service.submit(baseDto as any, [{ originalname: "a.pdf", mimetype: "application/pdf", size: PDF.length, buffer: PDF }], {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("returns 404 for unknown or inactive services", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.service, "findFirst").mockResolvedValue(null);
      await expect(service.submit(baseDto as any, [], {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rate-limits, stores the inquiry with a server-assigned owner and audits it", async () => {
      const { service, rateLimiter, audit } = makeService();
      jest.spyOn(prisma.service, "findFirst").mockResolvedValue({ id: "svc-1" } as any);
      const create = jest
        .spyOn(prisma.serviceInquiry, "create")
        .mockResolvedValue({ id: "inq-1", inquiryNumber: "SI-202610-ABCDEF", status: "NEW" } as any);

      const res = await service.submit(
        { ...baseDto, contactEmail: "a@example.com" } as any,
        [{ originalname: "brief.pdf", mimetype: "image/png", size: PDF.length, buffer: PDF }],
        { userId: "cust-1", ipAddress: "1.2.3.4" },
      );

      expect(res).toEqual({ inquiryNumber: "SI-202610-ABCDEF", status: "NEW" });
      expect(rateLimiter.consumeForSubmission).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), "a@example.com");
      const data = create.mock.calls[0][0].data as any;
      expect(data.userId).toBe("cust-1");
      expect(data.status).toBe("NEW");
      expect(data.ipHash).not.toContain("1.2.3.4");
      expect(data.attachments.create[0].mimeType).toBe("application/pdf");
      expect(audit.logActionWithClient).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "SERVICE_INQUIRY_SUBMITTED" }));
    });

    it("returns the original inquiry for a retried submissionKey without consuming quota", async () => {
      const { service, rateLimiter } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(
        inquiryRow({ submissionKey: "k", contactEmail: "a@example.com" }) as any,
      );
      const res = await service.submit({ ...baseDto, submissionKey: "k" } as any, [], {});
      expect(res.inquiryNumber).toBe("SI-202610-AAAAAA");
      expect(rateLimiter.consumeForSubmission).not.toHaveBeenCalled();
    });

    it("refuses a submissionKey reused with a different email", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(
        inquiryRow({ submissionKey: "k", contactEmail: "other@example.com" }) as any,
      );
      await expect(service.submit({ ...baseDto, submissionKey: "k" } as any, [], {})).rejects.toBeInstanceOf(ConflictException);
    });

    it("removes uploaded objects when the database write fails", async () => {
      const { service, files } = makeService();
      jest.spyOn(prisma.service, "findFirst").mockResolvedValue({ id: "svc-1" } as any);
      jest.spyOn(prisma.serviceInquiry, "create").mockRejectedValue(new Error("db down"));
      await expect(
        service.submit(baseDto as any, [{ originalname: "a.pdf", mimetype: "application/pdf", size: PDF.length, buffer: PDF }], {
          userId: "cust-1",
        }),
      ).rejects.toThrow("db down");
      expect(files.deleteObjects).toHaveBeenCalledWith([expect.stringContaining("services/inquiries/")]);
    });
  });

  describe("customer ownership (IDOR)", () => {
    it("returns 404 for another customer's inquiry", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findFirst").mockResolvedValue(inquiryRow({ userId: "cust-2" }) as any);
      await expect(service.getMine("cust-1", "inq-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns 404 for anonymous inquiries even if the id is known", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findFirst").mockResolvedValue(inquiryRow({ userId: null }) as any);
      await expect(service.getMine("cust-1", "inq-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("does not sign URLs for another customer's attachment", async () => {
      const { service, files } = makeService();
      jest.spyOn(prisma.serviceInquiryAttachment, "findFirst").mockResolvedValue({
        id: "att-1",
        storageKey: "k",
        fileName: "a.pdf",
        inquiry: { userId: "cust-2" },
      } as any);
      await expect(service.getMyAttachmentUrl("cust-1", "inq-1", "att-1")).rejects.toBeInstanceOf(NotFoundException);
      expect(files.signedUrl).not.toHaveBeenCalled();
    });

    it("scopes the customer list to the caller", async () => {
      const { service } = makeService();
      const count = jest.spyOn(prisma.serviceInquiry, "count").mockResolvedValue(0);
      jest.spyOn(prisma.serviceInquiry, "findMany").mockResolvedValue([]);
      await service.listMine("cust-1", {});
      expect(count).toHaveBeenCalledWith({ where: { userId: "cust-1" } });
    });
  });

  describe("adminUpdate", () => {
    const actor = { userId: "admin-1" };

    it("refuses CONVERTED as a manual status", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "QUALIFIED" }) as any);
      await expect(service.adminUpdate("inq-1", { status: "CONVERTED" as any }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses invalid transitions", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "SPAM" }) as any);
      await expect(service.adminUpdate("inq-1", { status: "QUALIFIED" as any }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("returns 409 when the status changed concurrently", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "NEW" }) as any);
      jest.spyOn(prisma.serviceInquiry, "updateMany").mockResolvedValue({ count: 0 });
      await expect(service.adminUpdate("inq-1", { status: "REVIEWING" as any }, actor)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("convert", () => {
    const actor = { userId: "admin-1" };

    it("only converts QUALIFIED inquiries", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "NEW" }) as any);
      await expect(service.convert("inq-1", {}, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("is idempotent: an already converted inquiry returns its project", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(
        inquiryRow({ status: "CONVERTED", project: { id: "prj-1" } }) as any,
      );
      const load = jest.spyOn(projectsModule, "loadAdminProject").mockResolvedValue({ id: "prj-1" } as any);
      const create = jest.spyOn(prisma.serviceProject, "create");
      await expect(service.convert("inq-1", {}, actor)).resolves.toEqual({ id: "prj-1" });
      expect(load).toHaveBeenCalledWith("prj-1");
      expect(create).not.toHaveBeenCalled();
    });

    it("requires an explicit customer account for anonymous inquiries", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "QUALIFIED", userId: null }) as any);
      await expect(service.convert("inq-1", {}, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates the project, marks the inquiry CONVERTED and records history in one transaction", async () => {
      const { service, audit } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "QUALIFIED" }) as any);
      const claim = jest.spyOn(prisma.serviceInquiry, "updateMany").mockResolvedValue({ count: 1 });
      const create = jest
        .spyOn(prisma.serviceProject, "create")
        .mockResolvedValue({ id: "prj-1", projectCode: "PRJ-202610-AAAAAA" } as any);
      jest.spyOn(projectsModule, "loadAdminProject").mockResolvedValue({ id: "prj-1" } as any);

      await service.convert("inq-1", { title: "Chatbot ABC" }, actor);

      expect(claim).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "inq-1", status: "QUALIFIED" }, data: expect.objectContaining({ status: "CONVERTED" }) }),
      );
      const data = create.mock.calls[0][0].data as any;
      expect(data.customerId).toBe("cust-1");
      expect(data.inquiryId).toBe("inq-1");
      expect(data.events.create.type).toBe("CREATED");
      expect(audit.logActionWithClient).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "SERVICE_INQUIRY_CONVERTED" }));
    });

    it("returns the winner's project when a concurrent conversion wins the race", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "QUALIFIED" }) as any);
      jest.spyOn(prisma.serviceInquiry, "updateMany").mockResolvedValue({ count: 0 });
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-9" } as any);
      jest.spyOn(projectsModule, "loadAdminProject").mockResolvedValue({ id: "prj-9" } as any);
      await expect(service.convert("inq-1", {}, actor)).resolves.toEqual({ id: "prj-9" });
    });

    it("surfaces the conflict when no project exists after a lost race", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceInquiry, "findUnique").mockResolvedValue(inquiryRow({ status: "QUALIFIED" }) as any);
      jest.spyOn(prisma.serviceInquiry, "updateMany").mockResolvedValue({ count: 0 });
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(null);
      await expect(service.convert("inq-1", {}, actor)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it("maps a duplicate submissionKey race to the original inquiry", async () => {
    const { service } = makeService();
    jest.spyOn(prisma.service, "findFirst").mockResolvedValue({ id: "svc-1" } as any);
    const findUnique = jest.spyOn(prisma.serviceInquiry, "findUnique");
    findUnique.mockResolvedValueOnce(null);
    findUnique.mockResolvedValueOnce(inquiryRow({ submissionKey: "k", contactEmail: "a@example.com" }) as any);
    jest
      .spyOn(prisma.serviceInquiry, "create")
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    const res = await service.submit({ ...baseDto, submissionKey: "k" } as any, [], {});
    expect(res.inquiryNumber).toBe("SI-202610-AAAAAA");
  });
});

describe("ServiceInquiriesService configuration", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  const build = (env: Record<string, string | undefined>) =>
    new ServiceInquiriesService({} as any, {} as any, {} as any, { get: (k: string) => env[k] } as any);

  it("refuses to start in production with the module enabled and no IP salt", () => {
    process.env.NODE_ENV = "production";
    process.env.FEATURE_SERVICES = "true";
    expect(() => build({ NODE_ENV: "production" })).toThrow(/SERVICE_INQUIRY_IP_SALT/);
  });

  it("still boots in production while the module is disabled", () => {
    process.env.NODE_ENV = "production";
    process.env.FEATURE_SERVICES = "false";
    expect(() => build({ NODE_ENV: "production" })).not.toThrow();
  });

  it("boots in production when the salt is configured", () => {
    process.env.NODE_ENV = "production";
    process.env.FEATURE_SERVICES = "true";
    expect(() => build({ NODE_ENV: "production", SERVICE_INQUIRY_IP_SALT: "x".repeat(32) })).not.toThrow();
  });
});
