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
   * Exactly-once semantics per OrderItem enforced via unique constraint.
   */
  async issueEntitlementsForOrder(
    orderId: string,
    externalTx?: Prisma.TransactionClient,
  ): Promise<Entitlement[]> {
    const execute = async (tx: Prisma.TransactionClient) => {
      // 1. Re-read Order inside transaction
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  licensePlan: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException(`Order '${orderId}' not found`);
      }

      // 2. State validation: MUST be PAID
      if (order.status !== OrderStatus.PAID) {
        throw new BadRequestException(
          `Cannot issue entitlements: Order is in status '${order.status}', expected '${OrderStatus.PAID}'`,
        );
      }

      if (order.items.length === 0) {
        this.logger.warn(`Order '${orderId}' has no items. Skipping entitlement issuance.`);
        return [];
      }

      const issuedEntitlements: Entitlement[] = [];

      for (const item of order.items) {
        // 3. Expiration policy resolution
        let expiresAt: Date | null = null;
        const activatedAt = new Date();
        const plan = item.variant?.licensePlan;

        if (plan) {
          if (plan.isLifetime) {
            expiresAt = null;
          } else if (plan.durationDays && plan.durationDays > 0) {
            expiresAt = new Date(
              activatedAt.getTime() + plan.durationDays * 86400000,
            );
          } else if (plan.durationMonths && plan.durationMonths > 0) {
            const exp = new Date(activatedAt);
            exp.setMonth(exp.getMonth() + plan.durationMonths);
            expiresAt = exp;
          }
        }

        // 4. Check if entitlement already exists (idempotent at-least-once recovery)
        const existing = await tx.entitlement.findUnique({
          where: { orderItemId: item.id },
        });

        if (existing) {
          issuedEntitlements.push(existing);
          continue;
        }

        // 5. Create missing entitlement
        try {
          const entitlement = await tx.entitlement.create({
            data: {
              userId: order.userId,
              orderId: order.id,
              orderItemId: item.id,
              productId: item.productId,
              variantId: item.variantId,
              productType: item.productType,
              fulfillmentType: item.fulfillmentType,
              status: EntitlementStatus.ACTIVE,
              quantity: item.quantity,
              activatedAt,
              expiresAt,
              metadata: {
                orderNumber: order.orderNumber,
                sku: item.sku,
                variantName: item.variantName,
                productName: item.productName,
              },
            },
          });

          // 6. Record audit log atomically
          await tx.auditLog.create({
            data: {
              action: "ENTITLEMENT_CREATED",
              entity: "Entitlement",
              entityId: entitlement.id,
              actorId: null,
              details: {
                actor: "system",
                orderId: order.id,
                orderItemId: item.id,
                userId: order.userId,
                sku: item.sku,
                quantity: item.quantity,
                status: entitlement.status,
                expiresAt: expiresAt?.toISOString() || null,
              },
            },
          });

          issuedEntitlements.push(entitlement);
        } catch (err: any) {
          // Handle concurrent worker race on unique orderItemId
          if (err?.code === "P2002") {
            const raceCreated = await tx.entitlement.findUnique({
              where: { orderItemId: item.id },
            });
            if (raceCreated) {
              issuedEntitlements.push(raceCreated);
              continue;
            }
          }
          throw err;
        }
      }

      return issuedEntitlements;
    };

    if (externalTx) {
      return execute(externalTx);
    }
    return prisma.$transaction(async (tx) => execute(tx));
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
      metadata: (e.metadata as any) || null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }
}
