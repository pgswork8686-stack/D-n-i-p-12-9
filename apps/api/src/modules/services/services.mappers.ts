import {
  AdminServiceInquiryDto,
  AdminServiceProjectDto,
  ServiceDto,
  ServiceFileDto,
  ServiceInquiryDto,
  ServiceMilestoneDto,
  ServiceProcessStep,
  ServiceProjectDocumentDto,
  ServiceProjectDto,
  ServiceProjectEventDto,
  ServiceProjectMemberDto,
  ServiceProjectMessageDto,
  ServiceProjectSummaryDto,
  ServiceBudgetRange,
  ServiceTimeline,
} from "@nexus/contracts";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asProcessSteps(value: unknown): ServiceProcessStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object" && typeof (v as any).title === "string")
    .map((v: any) => ({ title: v.title, description: typeof v.description === "string" ? v.description : "" }));
}

type UserWithProfile = { id: string; email: string | null; profile?: { displayName: string | null } | null };

const displayNameOf = (u: UserWithProfile | null | undefined): string | null =>
  u?.profile?.displayName || u?.email || null;

export function toServiceDto(s: any): ServiceDto {
  const productSlug =
    s.pricingMode === "DIRECT_CHECKOUT" && s.product && s.product.status === "ACTIVE" ? s.product.slug : null;
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    summary: s.summary,
    description: s.description,
    features: asStringArray(s.features),
    processSteps: asProcessSteps(s.processSteps),
    imageUrl: s.imageUrl ?? null,
    ctaLabel: s.ctaLabel,
    pricingMode: s.pricingMode,
    productSlug,
    status: s.status,
    sortOrder: s.sortOrder,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toFileDto(f: any): ServiceFileDto {
  return {
    id: f.id,
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toInquiryDto(i: any): ServiceInquiryDto {
  return {
    id: i.id,
    inquiryNumber: i.inquiryNumber,
    service: { id: i.service.id, slug: i.service.slug, name: i.service.name },
    companyName: i.companyName,
    contactName: i.contactName,
    contactEmail: i.contactEmail,
    contactPhone: i.contactPhone ?? null,
    requirements: i.requirements,
    desiredFeatures: asStringArray(i.desiredFeatures),
    budgetRange: (i.budgetRange as ServiceBudgetRange) ?? null,
    timeline: (i.timeline as ServiceTimeline) ?? null,
    status: i.status,
    attachments: (i.attachments || []).map(toFileDto),
    projectId: i.project?.id ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function toAdminInquiryDto(i: any): AdminServiceInquiryDto {
  return {
    ...toInquiryDto(i),
    userId: i.userId ?? null,
    staffNote: i.staffNote ?? null,
    reviewedById: i.reviewedById ?? null,
    reviewedAt: iso(i.reviewedAt),
  };
}

function toMilestoneDto(m: any): ServiceMilestoneDto {
  return {
    id: m.id,
    title: m.title,
    description: m.description ?? null,
    dueDate: iso(m.dueDate),
    status: m.status,
    sortOrder: m.sortOrder,
    completedAt: iso(m.completedAt),
  };
}

function toMemberDto(m: any): ServiceProjectMemberDto {
  return {
    id: m.id,
    userId: m.userId,
    displayName: displayNameOf(m.user),
    email: m.user?.email ?? null,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  };
}

function toDocumentDto(d: any): ServiceProjectDocumentDto {
  return { ...toFileDto(d), visibility: d.visibility, uploaderType: d.uploaderType };
}

function toMessageDto(m: any): ServiceProjectMessageDto {
  return {
    id: m.id,
    senderType: m.senderType,
    senderName: displayNameOf(m.sender),
    isInternalNote: m.isInternalNote,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

function toEventDto(e: any): ServiceProjectEventDto {
  return {
    id: e.id,
    type: e.type,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    details: (e.details as Record<string, unknown>) ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toProjectSummaryDto(p: any): ServiceProjectSummaryDto {
  const milestones: any[] = (p.milestones || []).filter((m: any) => m.status !== "CANCELLED");
  return {
    id: p.id,
    projectCode: p.projectCode,
    title: p.title,
    service: { id: p.service.id, slug: p.service.slug, name: p.service.name },
    status: p.status,
    startDate: iso(p.startDate),
    targetDate: iso(p.targetDate),
    completedAt: iso(p.completedAt),
    milestoneProgress: {
      done: milestones.filter((m) => m.status === "DONE").length,
      total: milestones.length,
    },
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Customer view: internal notes, internal documents and internal events are
 * removed here as a second line of defence (queries already filter them).
 */
export function toCustomerProjectDto(p: any): ServiceProjectDto {
  return {
    ...toProjectSummaryDto(p),
    summary: p.summary ?? null,
    inquiryNumber: p.inquiry?.inquiryNumber ?? null,
    members: (p.members || []).map(toMemberDto).map((m: ServiceProjectMemberDto) => ({ ...m, email: null })),
    milestones: (p.milestones || []).map(toMilestoneDto),
    documents: (p.documents || []).filter((d: any) => d.visibility === "CUSTOMER").map(toDocumentDto),
    messages: (p.messages || []).filter((m: any) => !m.isInternalNote).map(toMessageDto),
    events: (p.events || []).filter((e: any) => !e.isInternal).map(toEventDto),
  };
}

export function toAdminProjectDto(p: any): AdminServiceProjectDto {
  return {
    ...toProjectSummaryDto(p),
    summary: p.summary ?? null,
    inquiryNumber: p.inquiry?.inquiryNumber ?? null,
    members: (p.members || []).map(toMemberDto),
    milestones: (p.milestones || []).map(toMilestoneDto),
    documents: (p.documents || []).map(toDocumentDto),
    messages: (p.messages || []).map(toMessageDto),
    events: (p.events || []).map(toEventDto),
    customer: {
      id: p.customer.id,
      email: p.customer.email ?? null,
      displayName: displayNameOf(p.customer),
    },
  };
}

/** ASCII-only download name so the signed Content-Disposition header stays valid. */
export function asciiFileName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^\x20-\x7e]/g, "_")
      .trim() || "file"
  );
}
