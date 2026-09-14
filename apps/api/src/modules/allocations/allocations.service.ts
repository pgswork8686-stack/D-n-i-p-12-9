import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import {
  prisma,
  AllocationEngineError,
  requestDomainAllocation,
  adminActivateAllocation as engineActivateAllocation,
  adminRejectAllocation as engineRejectAllocation,
  requestAllocationDeactivation as engineRequestDeactivation,
  adminConfirmDeactivated as engineConfirmDeactivated,
  ProviderAccountStatus,
  AllocationStatus,
} from "@nexus/database";
import {
  CustomerAllocationDto,
  LicenseAllocationDto,
  LicenseProviderDto,
  ProviderAccountDto,
  PaginatedResponse,
} from "@nexus/contracts";
import {
  RequestAllocationDto,
  CustomerRequestDeactivationDto,
  AdminActivateAllocationDto,
  AdminRejectAllocationDto,
  AdminRequestDeactivationDto,
  AdminConfirmDeactivatedDto,
  CreateProviderAccountDto,
  UpdateProviderAccountDto,
  AdminAllocationFilterDto,
} from "./dto/allocations.dto";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class AllocationsService {
  constructor(private readonly auditService: AuditService) {}

  private handleEngineError(error: any): never {
    if (error instanceof AllocationEngineError) {
      switch (error.statusCode) {
        case 400:
          throw new BadRequestException(error.message);
        case 403:
          throw new ForbiddenException(error.message);
        case 404:
          throw new NotFoundException(error.message);
        case 409:
          throw new ConflictException(error.message);
        default:
          throw new BadRequestException(error.message);
      }
    }
    if (error instanceof Error) {
      if (
        error.message.includes("Unique constraint failed") ||
        error.message.includes("unique_active_provider_domain") ||
        error.message.includes("unique_non_terminal_entitlement_domain")
      ) {
        throw new ConflictException(
          "Duplicate domain allocation conflict detected in database",
        );
      }
      throw new BadRequestException(error.message);
    }
    throw new InternalServerErrorException("Unexpected allocation error");
  }

  // ---------------------------------------------------------------------------
  // Customer Operations
  // ---------------------------------------------------------------------------

  async requestAllocation(
    entitlementId: string,
    userId: string,
    dto: RequestAllocationDto,
  ): Promise<CustomerAllocationDto> {
    try {
      const allocation = await requestDomainAllocation({
        entitlementId,
        userId,
        domain: dto.domain,
      });

      const provider = await prisma.licenseProvider.findUnique({
        where: { id: allocation.providerId },
      });

      return {
        id: allocation.id,
        entitlementId: allocation.entitlementId,
        providerCode: provider?.code || "ELEMENTOR",
        domain: allocation.domain,
        normalizedDomain: allocation.normalizedDomain,
        status: allocation.status,
        fulfillmentMode: "MANUAL_EXTERNAL",
        requestedAt: allocation.requestedAt.toISOString(),
        activatedAt: allocation.activatedAt?.toISOString() || null,
        deactivatedAt: allocation.deactivatedAt?.toISOString() || null,
        createdAt: allocation.createdAt.toISOString(),
      };
    } catch (err) {
      this.handleEngineError(err);
    }
  }

  async listCustomerAllocations(
    entitlementId: string,
    userId: string,
  ): Promise<CustomerAllocationDto[]> {
    const entitlement = await prisma.entitlement.findUnique({
      where: { id: entitlementId },
    });

    if (!entitlement) {
      throw new NotFoundException("Entitlement not found");
    }

    if (entitlement.userId !== userId) {
      throw new ForbiddenException(
        "Forbidden: You do not own this entitlement",
      );
    }

    const allocations = await prisma.licenseAllocation.findMany({
      where: { entitlementId },
      include: { provider: true },
      orderBy: { createdAt: "desc" },
    });

    return allocations.map((a) => ({
      id: a.id,
      entitlementId: a.entitlementId,
      providerCode: a.provider.code,
      domain: a.domain,
      normalizedDomain: a.normalizedDomain,
      status: a.status,
      fulfillmentMode: "MANUAL_EXTERNAL",
      requestedAt: a.requestedAt.toISOString(),
      activatedAt: a.activatedAt?.toISOString() || null,
      deactivatedAt: a.deactivatedAt?.toISOString() || null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async customerRequestDeactivation(
    entitlementId: string,
    allocationId: string,
    userId: string,
    dto: CustomerRequestDeactivationDto,
  ): Promise<CustomerAllocationDto> {
    try {
      const allocation = await prisma.licenseAllocation.findUnique({
        where: { id: allocationId },
        include: { provider: true },
      });

      if (!allocation || allocation.entitlementId !== entitlementId) {
        throw new NotFoundException("Allocation not found for this entitlement");
      }

      const updated = await engineRequestDeactivation({
        allocationId,
        actorId: userId,
        isCustomer: true,
        reason: dto.reason,
      });

      return {
        id: updated.id,
        entitlementId: updated.entitlementId,
        providerCode: allocation.provider.code,
        domain: updated.domain,
        normalizedDomain: updated.normalizedDomain,
        status: updated.status,
        fulfillmentMode: "MANUAL_EXTERNAL",
        requestedAt: updated.requestedAt.toISOString(),
        activatedAt: updated.activatedAt?.toISOString() || null,
        deactivatedAt: updated.deactivatedAt?.toISOString() || null,
        createdAt: updated.createdAt.toISOString(),
      };
    } catch (err) {
      this.handleEngineError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Admin Operations: Providers & Accounts
  // ---------------------------------------------------------------------------

  async adminListProviders(): Promise<LicenseProviderDto[]> {
    const providers = await prisma.licenseProvider.findMany({
      orderBy: { name: "asc" },
    });

    return providers.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      fulfillmentMode: p.fulfillmentMode,
      metadata: (p.metadata as any) || null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  async adminListProviderAccounts(
    providerId?: string,
  ): Promise<ProviderAccountDto[]> {
    const whereClause: any = {};
    if (providerId) {
      whereClause.providerId = providerId;
    }

    const accounts = await prisma.providerAccount.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            allocations: {
              where: { status: AllocationStatus.ACTIVE },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return accounts.map((acc) => {
      const activeCount = acc._count.allocations;
      const available = Math.max(0, acc.totalCapacity - activeCount);
      return {
        id: acc.id,
        providerId: acc.providerId,
        name: acc.name,
        externalReference: acc.externalReference,
        totalCapacity: acc.totalCapacity,
        activeAllocationsCount: activeCount,
        availableCapacity: available,
        status: acc.status,
        metadata: (acc.metadata as any) || null,
        createdAt: acc.createdAt.toISOString(),
        updatedAt: acc.updatedAt.toISOString(),
      };
    });
  }

  async adminCreateProviderAccount(
    dto: CreateProviderAccountDto,
    actorId: string,
  ): Promise<ProviderAccountDto> {
    const provider = await prisma.licenseProvider.findUnique({
      where: { id: dto.providerId },
    });

    if (!provider) {
      throw new NotFoundException("License provider not found");
    }

    const account = await prisma.providerAccount.create({
      data: {
        providerId: dto.providerId,
        name: dto.name,
        totalCapacity: dto.totalCapacity,
        externalReference: dto.externalReference || null,
        status: dto.status || ProviderAccountStatus.ACTIVE,
        metadata: dto.metadata || {},
      },
    });

    await this.auditService.logAction({
      action: "PROVIDER_ACCOUNT_CREATED",
      entity: "ProviderAccount",
      entityId: account.id,
      actorId,
      details: {
        providerId: dto.providerId,
        name: dto.name,
        totalCapacity: dto.totalCapacity,
      },
    });

    return {
      id: account.id,
      providerId: account.providerId,
      name: account.name,
      externalReference: account.externalReference,
      totalCapacity: account.totalCapacity,
      activeAllocationsCount: 0,
      availableCapacity: account.totalCapacity,
      status: account.status,
      metadata: (account.metadata as any) || null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  async adminGetProviderAccount(id: string): Promise<ProviderAccountDto> {
    const account = await prisma.providerAccount.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            allocations: {
              where: { status: AllocationStatus.ACTIVE },
            },
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException("Provider account not found");
    }

    const activeCount = account._count.allocations;
    const available = Math.max(0, account.totalCapacity - activeCount);

    return {
      id: account.id,
      providerId: account.providerId,
      name: account.name,
      externalReference: account.externalReference,
      totalCapacity: account.totalCapacity,
      activeAllocationsCount: activeCount,
      availableCapacity: available,
      status: account.status,
      metadata: (account.metadata as any) || null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  async adminUpdateProviderAccount(
    id: string,
    dto: UpdateProviderAccountDto,
    actorId: string,
  ): Promise<ProviderAccountDto> {
    const existing = await prisma.providerAccount.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException("Provider account not found");
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.totalCapacity !== undefined) data.totalCapacity = dto.totalCapacity;
    if (dto.externalReference !== undefined)
      data.externalReference = dto.externalReference;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.metadata !== undefined) data.metadata = dto.metadata;

    const updated = await prisma.providerAccount.update({
      where: { id },
      data,
      include: {
        _count: {
          select: {
            allocations: {
              where: { status: AllocationStatus.ACTIVE },
            },
          },
        },
      },
    });

    await this.auditService.logAction({
      action: "PROVIDER_ACCOUNT_UPDATED",
      entity: "ProviderAccount",
      entityId: id,
      actorId,
      details: dto,
    });

    const activeCount = updated._count.allocations;
    const available = Math.max(0, updated.totalCapacity - activeCount);

    return {
      id: updated.id,
      providerId: updated.providerId,
      name: updated.name,
      externalReference: updated.externalReference,
      totalCapacity: updated.totalCapacity,
      activeAllocationsCount: activeCount,
      availableCapacity: available,
      status: updated.status,
      metadata: (updated.metadata as any) || null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Admin Operations: Allocations Management
  // ---------------------------------------------------------------------------

  async adminListAllocations(
    query: AdminAllocationFilterDto,
  ): Promise<PaginatedResponse<LicenseAllocationDto>> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.providerId) where.providerId = query.providerId;
    if (query.providerAccountId) where.providerAccountId = query.providerAccountId;
    if (query.entitlementId) where.entitlementId = query.entitlementId;
    if (query.userId) where.userId = query.userId;
    if (query.domain) {
      where.OR = [
        { domain: { contains: query.domain, mode: "insensitive" } },
        { normalizedDomain: { contains: query.domain, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.licenseAllocation.count({ where }),
      prisma.licenseAllocation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      items: items.map((a) => ({
        id: a.id,
        entitlementId: a.entitlementId,
        providerId: a.providerId,
        providerAccountId: a.providerAccountId,
        userId: a.userId,
        domain: a.domain,
        normalizedDomain: a.normalizedDomain,
        status: a.status,
        requestedAt: a.requestedAt.toISOString(),
        activatedAt: a.activatedAt?.toISOString() || null,
        deactivatedAt: a.deactivatedAt?.toISOString() || null,
        metadata: (a.metadata as any) || null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminGetAllocation(id: string): Promise<LicenseAllocationDto> {
    const a = await prisma.licenseAllocation.findUnique({
      where: { id },
    });

    if (!a) {
      throw new NotFoundException("License allocation not found");
    }

    return {
      id: a.id,
      entitlementId: a.entitlementId,
      providerId: a.providerId,
      providerAccountId: a.providerAccountId,
      userId: a.userId,
      domain: a.domain,
      normalizedDomain: a.normalizedDomain,
      status: a.status,
      requestedAt: a.requestedAt.toISOString(),
      activatedAt: a.activatedAt?.toISOString() || null,
      deactivatedAt: a.deactivatedAt?.toISOString() || null,
      metadata: (a.metadata as any) || null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  async adminActivateAllocation(
    id: string,
    dto: AdminActivateAllocationDto,
    actorId: string,
  ): Promise<LicenseAllocationDto> {
    try {
      const updated = await engineActivateAllocation({
        allocationId: id,
        providerAccountId: dto.providerAccountId,
        actorId,
        notes: dto.notes,
      });

      return {
        id: updated.id,
        entitlementId: updated.entitlementId,
        providerId: updated.providerId,
        providerAccountId: updated.providerAccountId,
        userId: updated.userId,
        domain: updated.domain,
        normalizedDomain: updated.normalizedDomain,
        status: updated.status,
        requestedAt: updated.requestedAt.toISOString(),
        activatedAt: updated.activatedAt?.toISOString() || null,
        deactivatedAt: updated.deactivatedAt?.toISOString() || null,
        metadata: (updated.metadata as any) || null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (err) {
      this.handleEngineError(err);
    }
  }

  async adminRejectAllocation(
    id: string,
    dto: AdminRejectAllocationDto,
    actorId: string,
  ): Promise<LicenseAllocationDto> {
    try {
      const updated = await engineRejectAllocation({
        allocationId: id,
        reason: dto.reason,
        actorId,
      });

      return {
        id: updated.id,
        entitlementId: updated.entitlementId,
        providerId: updated.providerId,
        providerAccountId: updated.providerAccountId,
        userId: updated.userId,
        domain: updated.domain,
        normalizedDomain: updated.normalizedDomain,
        status: updated.status,
        requestedAt: updated.requestedAt.toISOString(),
        activatedAt: updated.activatedAt?.toISOString() || null,
        deactivatedAt: updated.deactivatedAt?.toISOString() || null,
        metadata: (updated.metadata as any) || null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (err) {
      this.handleEngineError(err);
    }
  }

  async adminRequestDeactivation(
    id: string,
    dto: AdminRequestDeactivationDto,
    actorId: string,
  ): Promise<LicenseAllocationDto> {
    try {
      const updated = await engineRequestDeactivation({
        allocationId: id,
        actorId,
        isCustomer: false,
        reason: dto.reason,
      });

      return {
        id: updated.id,
        entitlementId: updated.entitlementId,
        providerId: updated.providerId,
        providerAccountId: updated.providerAccountId,
        userId: updated.userId,
        domain: updated.domain,
        normalizedDomain: updated.normalizedDomain,
        status: updated.status,
        requestedAt: updated.requestedAt.toISOString(),
        activatedAt: updated.activatedAt?.toISOString() || null,
        deactivatedAt: updated.deactivatedAt?.toISOString() || null,
        metadata: (updated.metadata as any) || null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (err) {
      this.handleEngineError(err);
    }
  }

  async adminConfirmDeactivated(
    id: string,
    dto: AdminConfirmDeactivatedDto,
    actorId: string,
  ): Promise<LicenseAllocationDto> {
    try {
      const updated = await engineConfirmDeactivated({
        allocationId: id,
        actorId,
        notes: dto.notes,
      });

      return {
        id: updated.id,
        entitlementId: updated.entitlementId,
        providerId: updated.providerId,
        providerAccountId: updated.providerAccountId,
        userId: updated.userId,
        domain: updated.domain,
        normalizedDomain: updated.normalizedDomain,
        status: updated.status,
        requestedAt: updated.requestedAt.toISOString(),
        activatedAt: updated.activatedAt?.toISOString() || null,
        deactivatedAt: updated.deactivatedAt?.toISOString() || null,
        metadata: (updated.metadata as any) || null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (err) {
      this.handleEngineError(err);
    }
  }
}
