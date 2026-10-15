import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { prisma } from "@nexus/database";
import { ServiceProjectsService } from "./service-projects.service";

const PDF = Buffer.from("%PDF-1.7 test");

function makeService() {
  const audit = { logActionWithClient: jest.fn().mockResolvedValue(undefined) };
  const files = {
    uploadAll: jest.fn(async (_s: string, owner: string, list: any[]) => list.map((f) => ({ ...f, storageKey: `services/projects/${owner}/x.pdf` }))),
    deleteObjects: jest.fn().mockResolvedValue(undefined),
    signedUrl: jest.fn().mockResolvedValue({ url: "https://signed", expiresInSeconds: 120 }),
  };
  const rateLimiter = { consume: jest.fn().mockResolvedValue(undefined) };
  const service = new ServiceProjectsService(audit as any, files as any, rateLimiter as any);
  return { service, audit, files, rateLimiter };
}

const user = (id: string) => ({ id, email: `${id}@example.com`, profile: { displayName: id } });

const projectRow = (over: Record<string, unknown> = {}) => ({
  id: "prj-1",
  projectCode: "PRJ-202610-AAAAAA",
  inquiryId: "inq-1",
  customerId: "cust-1",
  serviceId: "svc-1",
  title: "Chatbot",
  summary: null,
  status: "PLANNING",
  startDate: null,
  targetDate: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  service: { id: "svc-1", slug: "ai-chatbot-development", name: "AI Chatbot" },
  inquiry: { inquiryNumber: "SI-1" },
  customer: user("cust-1"),
  members: [{ id: "m1", userId: "staff-1", role: "LEAD", createdAt: new Date(), user: user("staff-1") }],
  milestones: [
    { id: "ms1", title: "Khảo sát", description: null, dueDate: null, status: "DONE", sortOrder: 0, completedAt: new Date() },
    { id: "ms2", title: "Build", description: null, dueDate: null, status: "PENDING", sortOrder: 1, completedAt: null },
  ],
  documents: [
    { id: "d1", fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 1, visibility: "CUSTOMER", uploaderType: "STAFF", createdAt: new Date() },
    { id: "d2", fileName: "cost.xlsx", mimeType: "x", sizeBytes: 1, visibility: "INTERNAL", uploaderType: "STAFF", createdAt: new Date() },
  ],
  messages: [
    { id: "msg1", senderType: "STAFF", isInternalNote: false, body: "Xin chào", createdAt: new Date(), sender: user("staff-1") },
    { id: "msg2", senderType: "STAFF", isInternalNote: true, body: "Margin 40%", createdAt: new Date(), sender: user("staff-1") },
  ],
  events: [
    { id: "e1", type: "CREATED", isInternal: false, fromStatus: null, toStatus: "PLANNING", details: null, createdAt: new Date() },
    { id: "e2", type: "MESSAGE_POSTED", isInternal: true, fromStatus: null, toStatus: null, details: null, createdAt: new Date() },
  ],
  ...over,
});

describe("ServiceProjectsService", () => {
  const actor = { userId: "admin-1" };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  describe("customer access", () => {
    it("returns 404 for a project owned by another customer", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findFirst").mockResolvedValue(projectRow({ customerId: "cust-2" }) as any);
      await expect(service.getMine("cust-1", "prj-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("never exposes internal notes, internal documents, internal events or staff emails", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findFirst").mockResolvedValue(projectRow() as any);
      const dto = await service.getMine("cust-1", "prj-1");
      expect(dto.messages.map((m) => m.id)).toEqual(["msg1"]);
      expect(dto.documents.map((d) => d.id)).toEqual(["d1"]);
      expect(dto.events.map((e) => e.id)).toEqual(["e1"]);
      expect(dto.members[0].email).toBeNull();
      expect(JSON.stringify(dto)).not.toContain("Margin 40%");
      expect(dto.milestoneProgress).toEqual({ done: 1, total: 2 });
    });

    it("filters internal records at the query level for customers", async () => {
      const { service } = makeService();
      const find = jest.spyOn(prisma.serviceProject, "findFirst").mockResolvedValue(projectRow() as any);
      await service.getMine("cust-1", "prj-1");
      const include = (find.mock.calls[0][0] as any).include;
      expect(include.messages.where).toEqual({ isInternalNote: false });
      expect(include.documents.where).toEqual({ visibility: "CUSTOMER" });
      expect(include.events.where).toEqual({ isInternal: false });
    });

    it("does not sign URLs for internal documents, even for the owner", async () => {
      const { service, files } = makeService();
      jest.spyOn(prisma.serviceProjectDocument, "findFirst").mockResolvedValue({
        id: "d2",
        storageKey: "k",
        fileName: "cost.xlsx",
        visibility: "INTERNAL",
        project: { customerId: "cust-1" },
      } as any);
      await expect(service.customerDocumentUrl("cust-1", "prj-1", "d2")).rejects.toBeInstanceOf(NotFoundException);
      expect(files.signedUrl).not.toHaveBeenCalled();
    });

    it("refuses customer messages on closed projects", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", customerId: "cust-1", status: "COMPLETED" } as any);
      await expect(service.customerPostMessage("cust-1", "prj-1", { body: "hi" })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses customer messages to someone else's project with 404", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", customerId: "cust-2", status: "IN_PROGRESS" } as any);
      await expect(service.customerPostMessage("cust-1", "prj-1", { body: "hi" })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("forces customer-uploaded documents to CUSTOMER visibility and rate-limits uploads", async () => {
      const { service, rateLimiter } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", customerId: "cust-1", status: "IN_PROGRESS" } as any);
      const create = jest.spyOn(prisma.serviceProjectDocument, "create").mockResolvedValue({ id: "d9", fileName: "a.pdf", sizeBytes: 1, sha256: "x" } as any);
      jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
      jest.spyOn(prisma.serviceProject, "update").mockResolvedValue({} as any);
      jest.spyOn(prisma.serviceProject, "findFirst").mockResolvedValue(projectRow() as any);

      await service.customerUploadDocument("cust-1", "prj-1", { originalname: "a.pdf", mimetype: "application/pdf", size: PDF.length, buffer: PDF }, {});

      expect(rateLimiter.consume).toHaveBeenCalledWith(expect.objectContaining({ key: "ratelimit:service-project:upload:cust-1" }));
      const data = create.mock.calls[0][0].data as any;
      expect(data.visibility).toBe("CUSTOMER");
      expect(data.uploaderType).toBe("CUSTOMER");
      expect(data.storageKey).toMatch(/^services\/projects\/prj-1\//);
    });

    it("scopes the customer project list to the caller", async () => {
      const { service } = makeService();
      const count = jest.spyOn(prisma.serviceProject, "count").mockResolvedValue(0);
      jest.spyOn(prisma.serviceProject, "findMany").mockResolvedValue([]);
      await service.listMine("cust-1", {});
      expect(count).toHaveBeenCalledWith({ where: { customerId: "cust-1" } });
    });
  });

  describe("admin project transitions", () => {
    it("rejects invalid transitions", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow({ status: "PLANNING" }) as any);
      await expect(service.adminUpdate("prj-1", { status: "COMPLETED" as any }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects changes to a completed project status", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow({ status: "COMPLETED" }) as any);
      await expect(service.adminUpdate("prj-1", { status: "IN_PROGRESS" as any }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("completes a project from review: sets completedAt, records history and audit", async () => {
      const { service, audit } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValueOnce(projectRow({ status: "IN_REVIEW" }) as any);
      const update = jest.spyOn(prisma.serviceProject, "updateMany").mockResolvedValue({ count: 1 });
      const event = jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow({ status: "COMPLETED" }) as any);

      await service.adminUpdate("prj-1", { status: "COMPLETED" as any }, actor);

      const args = update.mock.calls[0][0] as any;
      expect(args.where).toEqual({ id: "prj-1", status: "IN_REVIEW" });
      expect(args.data.status).toBe("COMPLETED");
      expect(args.data.completedAt).toBeInstanceOf(Date);
      expect(event).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: "STATUS_CHANGED", fromStatus: "IN_REVIEW", toStatus: "COMPLETED" }),
      });
      expect(audit.logActionWithClient).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "SERVICE_PROJECT_STATUS_CHANGED" }));
    });

    it("sets startDate automatically when work starts", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow({ status: "PLANNING" }) as any);
      const update = jest.spyOn(prisma.serviceProject, "updateMany").mockResolvedValue({ count: 1 });
      jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
      await service.adminUpdate("prj-1", { status: "IN_PROGRESS" as any }, actor);
      expect((update.mock.calls[0][0] as any).data.startDate).toBeInstanceOf(Date);
    });

    it("returns 409 on a concurrent status change", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow({ status: "PLANNING" }) as any);
      jest.spyOn(prisma.serviceProject, "updateMany").mockResolvedValue({ count: 0 });
      await expect(service.adminUpdate("prj-1", { status: "IN_PROGRESS" as any }, actor)).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects a target date before the start date", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow() as any);
      await expect(
        service.adminUpdate("prj-1", { startDate: "2026-12-01", targetDate: "2026-11-01" }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("staff assignment", () => {
    it("refuses to assign customer-only accounts", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", status: "PLANNING" } as any);
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "cust-9", userRoles: [{ role: { name: "customer" } }] } as any);
      await expect(service.assignMember("prj-1", { userId: "cust-9" }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("assigns staff idempotently and records history", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValueOnce({ id: "prj-1", status: "PLANNING" } as any);
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "staff-2", userRoles: [{ role: { name: "support_agent" } }] } as any);
      const upsert = jest.spyOn(prisma.serviceProjectMember, "upsert").mockResolvedValue({} as any);
      const event = jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow() as any);

      await service.assignMember("prj-1", { userId: "staff-2", role: "LEAD" as any }, actor);

      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId_userId: { projectId: "prj-1", userId: "staff-2" } } }));
      expect(event).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "MEMBER_ASSIGNED" }) });
    });
  });

  describe("milestones", () => {
    it("rejects invalid milestone transitions", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", status: "IN_PROGRESS" } as any);
      jest.spyOn(prisma.serviceMilestone, "findFirst").mockResolvedValue({ id: "ms1", projectId: "prj-1", status: "DONE", title: "x" } as any);
      await expect(service.updateMilestone("prj-1", "ms1", { status: "CANCELLED" as any }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("scopes milestone lookups to the project in the URL", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", status: "IN_PROGRESS" } as any);
      const find = jest.spyOn(prisma.serviceMilestone, "findFirst").mockResolvedValue(null);
      await expect(service.updateMilestone("prj-1", "ms-other", { title: "x" }, actor)).rejects.toBeInstanceOf(NotFoundException);
      expect(find).toHaveBeenCalledWith({ where: { id: "ms-other", projectId: "prj-1" } });
    });

    it("refuses new milestones on closed projects", async () => {
      const { service } = makeService();
      jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", status: "CANCELLED" } as any);
      await expect(service.createMilestone("prj-1", { title: "x" }, actor)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it("marks staff internal notes as internal history", async () => {
    const { service } = makeService();
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValueOnce({ id: "prj-1", status: "IN_PROGRESS" } as any);
    const msg = jest.spyOn(prisma.serviceProjectMessage, "create").mockResolvedValue({} as any);
    const event = jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
    jest.spyOn(prisma.serviceProject, "update").mockResolvedValue({} as any);
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow() as any);

    await service.staffPostMessage("prj-1", { body: "note", isInternalNote: true }, actor);

    expect((msg.mock.calls[0][0] as any).data.isInternalNote).toBe(true);
    expect((event.mock.calls[0][0] as any).data.isInternal).toBe(true);
  });
});

describe("ServiceProjectsService hardening", () => {
  const actor = { userId: "admin-1" };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  it("never falls back to staff emails or exposes staff ids/event details to customers", async () => {
    const { service } = makeService();
    const noName = { id: "staff-9", email: "secret.staff@pgs.vn", profile: null };
    jest.spyOn(prisma.serviceProject, "findFirst").mockResolvedValue(
      projectRow({
        members: [{ id: "m9", userId: "staff-9", role: "MEMBER", createdAt: new Date(), user: noName }],
        messages: [{ id: "x", senderType: "STAFF", isInternalNote: false, body: "hi", createdAt: new Date(), sender: noName }],
        events: [{ id: "e1", type: "MILESTONE_UPDATED", isInternal: false, fromStatus: null, toStatus: null, details: { milestoneId: "ms1" }, createdAt: new Date() }],
      }) as any,
    );
    const dto = await service.getMine("cust-1", "prj-1");
    expect(JSON.stringify(dto)).not.toContain("secret.staff@pgs.vn");
    expect(JSON.stringify(dto)).not.toContain("staff-9");
    expect(dto.members[0]).toMatchObject({ displayName: "PGS team", userId: null, email: null });
    expect(dto.messages[0].senderName).toBe("PGS team");
    expect(dto.events[0].details).toBeNull();
  });

  it("records staffing changes as internal history", async () => {
    const { service } = makeService();
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValueOnce({ id: "prj-1", status: "PLANNING" } as any);
    jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "staff-2", userRoles: [{ role: { name: "ops" } }] } as any);
    jest.spyOn(prisma.serviceProjectMember, "upsert").mockResolvedValue({} as any);
    const event = jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow() as any);
    await service.assignMember("prj-1", { userId: "staff-2" }, actor);
    expect((event.mock.calls[0][0] as any).data.isInternal).toBe(true);
  });

  it("audits staff messages, including internal notes", async () => {
    const { service, audit } = makeService();
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValueOnce({ id: "prj-1", status: "IN_PROGRESS" } as any);
    jest.spyOn(prisma.serviceProjectMessage, "create").mockResolvedValue({ id: "msg-9" } as any);
    jest.spyOn(prisma.serviceProjectEvent, "create").mockResolvedValue({} as any);
    jest.spyOn(prisma.serviceProject, "update").mockResolvedValue({} as any);
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue(projectRow() as any);
    await service.staffPostMessage("prj-1", { body: "note", isInternalNote: true }, actor);
    expect(audit.logActionWithClient).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: "SERVICE_PROJECT_MESSAGE_POSTED", details: { messageId: "msg-9", internal: true } }),
    );
  });

  it.each([
    ["staffPostMessage", (s: ServiceProjectsService) => s.staffPostMessage("prj-1", { body: "x" }, actor)],
    ["updateMilestone", (s: ServiceProjectsService) => s.updateMilestone("prj-1", "ms1", { title: "x" }, actor)],
    [
      "staffUploadDocument",
      (s: ServiceProjectsService) =>
        s.staffUploadDocument("prj-1", { originalname: "a.pdf", mimetype: "application/pdf", size: PDF.length, buffer: PDF }, undefined, actor),
    ],
  ])("refuses %s on a closed project", async (_name, act) => {
    const { service } = makeService();
    jest.spyOn(prisma.serviceProject, "findUnique").mockResolvedValue({ id: "prj-1", status: "COMPLETED" } as any);
    await expect(act(service)).rejects.toBeInstanceOf(BadRequestException);
  });
});
