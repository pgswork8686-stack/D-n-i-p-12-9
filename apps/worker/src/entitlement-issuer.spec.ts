import { issueEntitlementsForOrder } from "./entitlement-issuer";
import { prisma, OrderStatus, EntitlementStatus } from "@nexus/database";

jest.mock("@nexus/database", () => {
  return {
    OrderStatus: {
      PENDING_PAYMENT: "PENDING_PAYMENT",
      PAID: "PAID",
      CANCELLED: "CANCELLED",
    },
    EntitlementStatus: {
      ACTIVE: "ACTIVE",
      REVOKED: "REVOKED",
      EXPIRED: "EXPIRED",
    },
    prisma: {
      order: {
        findUnique: jest.fn(),
      },
      entitlement: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    },
  };
});

describe("issueEntitlementsForOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws error if order is not found", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(issueEntitlementsForOrder("ord-missing")).rejects.toThrow(
      "Order 'ord-missing' not found",
    );
  });

  it("throws error if order is not in PAID status", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: "ord-pending",
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
    });

    await expect(issueEntitlementsForOrder("ord-pending")).rejects.toThrow(
      "Cannot issue entitlements: Order is in status 'PENDING_PAYMENT', expected 'PAID'",
    );
  });

  it("returns empty if order has no items", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: "ord-empty",
      status: OrderStatus.PAID,
      items: [],
    });

    const result = await issueEntitlementsForOrder("ord-empty");
    expect(result.issuedCount).toBe(0);
    expect(result.entitlements).toEqual([]);
  });

  it("issues lifetime entitlement with null expiresAt for lifetime plan", async () => {
    const mockOrder = {
      id: "ord-1",
      orderNumber: "ORD-001",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-1",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-LIFE",
          variantName: "Lifetime License",
          productName: "Pro Theme",
          quantity: 1,
          variant: {
            licensePlan: {
              isLifetime: true,
            },
          },
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(null);
    const mockCreatedEntitlement = {
      id: "ent-1",
      orderId: "ord-1",
      orderItemId: "item-1",
      userId: "user-1",
      status: EntitlementStatus.ACTIVE,
      expiresAt: null,
    };
    (prisma.entitlement.create as jest.Mock).mockResolvedValue(mockCreatedEntitlement);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-1" });

    const result = await issueEntitlementsForOrder("ord-1");

    expect(prisma.entitlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: "ord-1",
        orderItemId: "item-1",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        expiresAt: null,
      }),
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ENTITLEMENT_CREATED",
        entity: "Entitlement",
        entityId: "ent-1",
      }),
    });

    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].expiresAt).toBeNull();
  });

  it("issues expiring entitlement with durationDays correctly calculated", async () => {
    const mockOrder = {
      id: "ord-2",
      orderNumber: "ORD-002",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-2",
          productId: "prod-2",
          variantId: "var-2",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-YEAR",
          variantName: "Annual License",
          productName: "Plugin Suite",
          quantity: 1,
          variant: {
            licensePlan: {
              isLifetime: false,
              durationDays: 365,
            },
          },
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.entitlement.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
      id: "ent-2",
      ...data,
    }));
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-2" });

    const before = Date.now();
    const result = await issueEntitlementsForOrder("ord-2");

    expect(result.issuedCount).toBe(1);
    const expiresAt = result.entitlements[0].expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    const diffDays = (expiresAt.getTime() - before) / (1000 * 60 * 60 * 24);
    expect(Math.round(diffDays)).toBe(365);
  });

  it("idempotently skips entitlement creation if already exists for orderItemId", async () => {
    const mockOrder = {
      id: "ord-3",
      orderNumber: "ORD-003",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-existing",
          productId: "prod-3",
          variantId: "var-3",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-EXISTING",
          quantity: 1,
        },
      ],
    };

    const existingEntitlement = {
      id: "ent-existing",
      orderItemId: "item-existing",
      status: EntitlementStatus.ACTIVE,
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(existingEntitlement);

    const result = await issueEntitlementsForOrder("ord-3");

    expect(prisma.entitlement.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].id).toBe("ent-existing");
  });

  it("recovers gracefully from concurrent race on unique orderItemId constraint (P2002)", async () => {
    const mockOrder = {
      id: "ord-4",
      orderNumber: "ORD-004",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-race",
          productId: "prod-4",
          variantId: "var-4",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-RACE",
          quantity: 1,
        },
      ],
    };

    const winnerEntitlement = {
      id: "ent-race-winner",
      orderItemId: "item-race",
      status: EntitlementStatus.ACTIVE,
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    // Initially not found before create
    (prisma.entitlement.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winnerEntitlement);

    const p2002Error: any = new Error("Unique constraint failed");
    p2002Error.code = "P2002";
    (prisma.entitlement.create as jest.Mock).mockRejectedValue(p2002Error);

    const result = await issueEntitlementsForOrder("ord-4");

    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].id).toBe("ent-race-winner");
  });
});
