import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  Prisma,
  Entitlement,
  EntitlementStatus,
  OrderStatus,
  issueEntitlementsForOrder as dbIssueEntitlementsForOrder,
} from "@nexus/database";
import { EntitlementDto, PaginatedResponse } from "@nexus/contracts";
import {
  AdminEntitlementFilterDto,
  EntitlementFilterDto,
} from "./dto/entitlements.dto";

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  /**
   * Authoritatively issues entitlements for an Order in PAID state.
   * Delegates to the single source of truth in @nexus/database domain engine.
   */
  async issueEntitlementsForOrder(
    orderId: string,
    externalTx?: Prisma.TransactionClient,
  ): Promise<Entitlement[]> {
    try {
      const result = await dbIssueEntitlementsForOrder(orderId, externalTx);
      return result.entitlements;
    } catch (err: any) {
      if (err.message?.includes("not found")) {
        throw new NotFoundException(err.message);
      }
      if (
        err.message?.includes("expected 'PAID'") ||
        err.message?.includes("Missing entitlement policy snapshot") ||
        err.message?.includes("Unsupported entitlement policy snapshot version") ||
        err.message?.includes("Malformed entitlement policy snapshot")
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * Retrieves paginated entitlements for a specific customer.
   */
  async listUserEntitlements(
    userId: string,
    filter: EntitlementFilterDto,
  ): Promise<PaginatedResponse<EntitlementDto>> {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.EntitlementWhereInput = {
      userId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.fulfillmentType
        ? { fulfillmentType: filter.fulfillmentType }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.entitlement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.entitlement.count({ where }),
    ]);

    return {
      items: items.map((e) => this.mapToDto(e)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieves a single entitlement for a customer with strict ownership enforcement.
   * Returns 404 if the entitlement does not exist or belongs to another user (enumeration prevention).
   */
  async getUserEntitlement(
    userId: string,
    id: string,
  ): Promise<EntitlementDto> {
    const entitlement = await prisma.entitlement.findUnique({
      where: { id },
    });

    if (!entitlement || entitlement.userId !== userId) {
      throw new NotFoundException(`Entitlement '${id}' not found`);
    }

    return this.mapToDto(entitlement);
  }

  /**
   * Admin: List all entitlements with administrative filtering and pagination.
   */
  async listAdminEntitlements(
    filter: AdminEntitlementFilterDto,
  ): Promise<PaginatedResponse<EntitlementDto>> {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.EntitlementWhereInput = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.orderId ? { orderId: filter.orderId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.fulfillmentType
        ? { fulfillmentType: filter.fulfillmentType }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.entitlement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.entitlement.count({ where }),
    ]);

    return {
      items: items.map((e) => this.mapToDto(e)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Admin: Get a single entitlement by ID.
   */
  async getAdminEntitlement(id: string): Promise<EntitlementDto> {
    const entitlement = await prisma.entitlement.findUnique({
      where: { id },
    });

    if (!entitlement) {
      throw new NotFoundException(`Entitlement '${id}' not found`);
    }

    return this.mapToDto(entitlement);
  }

  /**
   * Admin: Revokes an active entitlement using optimistic CAS state transition.
   * Fails closed if the entitlement is already in a terminal state (REVOKED, EXPIRED).
   */
  async revokeEntitlement(
    id: string,
    actorId: string,
    reason?: string,
  ): Promise<EntitlementDto> {
    return prisma.$transaction(async (tx) => {
      // 1. CAS conditional update: ONLY update if currently ACTIVE
      const updateResult = await tx.entitlement.updateMany({
        where: {
          id,
          status: EntitlementStatus.ACTIVE,
        },
        data: {
          status: EntitlementStatus.REVOKED,
          revokedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        const existing = await tx.entitlement.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException(`Entitlement '${id}' not found`);
        }
        throw new ConflictException(
          `Cannot revoke entitlement: Entitlement is already in terminal state '${existing.status}'`,
        );
      }

      const updated = await tx.entitlement.findUnique({ where: { id } });

      // 2. Record audit log atomically
      await tx.auditLog.create({
        data: {
          action: "ENTITLEMENT_REVOKED",
          entity: "Entitlement",
          entityId: id,
          actorId,
          details: {
            reason: reason || "Manual admin revocation",
            previousStatus: "ACTIVE",
            newStatus: "REVOKED",
          },
        },
      });

      return this.mapToDto(updated!);
    });
  }

  /**
   * Maps Prisma Entitlement model to DTO.
   */
  mapToDto(e: Entitlement): EntitlementDto {
    return {
      id: e.id,
      userId: e.userId,
      orderId: e.orderId,
      orderItemId: e.orderItemId,
      productId: e.productId,
      variantId: e.variantId,
      productType: e.productType,
      fulfillmentType: e.fulfillmentType,
      status: e.status as any,
      quantity: e.quantity,
      activatedAt: e.activatedAt.toISOString(),
      expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
      revokedAt: e.revokedAt ? e.revokedAt.toISOString() : null,
      maxActivations: e.maxActivations ?? null,
      updatesUntil: e.updatesUntil ? e.updatesUntil.toISOString() : null,
      supportUntil: e.supportUntil ? e.supportUntil.toISOString() : null,
      metadata: (e.metadata as any) || null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }
}
