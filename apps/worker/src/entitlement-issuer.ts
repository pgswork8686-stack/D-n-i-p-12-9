import {
  prisma,
  Prisma,
  Entitlement,
  EntitlementStatus,
  OrderStatus,
} from "@nexus/database";

export interface IssueEntitlementsResult {
  orderId: string;
  issuedCount: number;
  entitlements: Entitlement[];
}

/**
 * Authoritatively issues entitlements for an Order in PAID state.
 * Exactly-once semantics per OrderItem enforced via database unique constraint on orderItemId.
 */
export async function issueEntitlementsForOrder(
  orderId: string,
  txClient?: Prisma.TransactionClient,
): Promise<IssueEntitlementsResult> {
  const runWithTx = async (tx: Prisma.TransactionClient) => {
    // 1. Fetch Order with items and variant licensePlan
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
      throw new Error(`Order '${orderId}' not found`);
    }

    if (order.status !== OrderStatus.PAID) {
      throw new Error(
        `Cannot issue entitlements: Order is in status '${order.status}', expected '${OrderStatus.PAID}'`,
      );
    }

    if (order.items.length === 0) {
      return { orderId, issuedCount: 0, entitlements: [] };
    }

    const issued: Entitlement[] = [];

    for (const item of order.items) {
      // 2. Check if entitlement already exists for this order item
      const existing = await tx.entitlement.findUnique({
        where: { orderItemId: item.id },
      });

      if (existing) {
        issued.push(existing);
        continue;
      }

      // 3. Resolve expiration policy
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

      // 4. Create entitlement & audit log atomically
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
              expiresAt: expiresAt ? expiresAt.toISOString() : null,
            },
          },
        });

        issued.push(entitlement);
      } catch (err: any) {
        if (err?.code === "P2002") {
          const raceCreated = await tx.entitlement.findUnique({
            where: { orderItemId: item.id },
          });
          if (raceCreated) {
            issued.push(raceCreated);
            continue;
          }
        }
        throw err;
      }
    }

    return {
      orderId,
      issuedCount: issued.length,
      entitlements: issued,
    };
  };

  if (txClient) {
    return runWithTx(txClient);
  }

  return prisma.$transaction(async (tx) => {
    return runWithTx(tx);
  });
}
