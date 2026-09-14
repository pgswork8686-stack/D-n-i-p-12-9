import {
  issueEntitlementsForOrder,
  expireDueEntitlements,
  calculateExpirationDate,
  addUtcMonths,
} from "./entitlement-issuer";
import { prisma, OrderStatus, EntitlementStatus } from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      order: {
        findUnique: jest.fn(),
      },
      entitlement: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (cb) => cb(prisma)),
    },
  };
});

describe("Deterministic UTC Month & Expiration Engine", () => {
  it("clamps month-end correctly for Jan 31 -> Feb 28 in non-leap year", () => {
    const jan31 = new Date(Date.UTC(2025, 0, 31, 12, 0, 0));
    const result = addUtcMonths(jan31, 1);
    expect(result.toISOString()).toBe("2025-02-28T12:00:00.000Z");
  });

  it("clamps month-end correctly for Jan 31 -> Feb 29 in leap year (2024)", () => {
    const jan31 = new Date(Date.UTC(2024, 0, 31, 12, 0, 0));
    const result = addUtcMonths(jan31, 1);
    expect(result.toISOString()).toBe("2024-02-29T12:00:00.000Z");
  });

  it("clamps month-end correctly for Aug 31 -> Sep 30", () => {
    const aug31 = new Date(Date.UTC(2026, 7, 31, 15, 30, 0));
    const result = addUtcMonths(aug31, 1);
    expect(result.toISOString()).toBe("2026-09-30T15:30:00.000Z");
  });

  it("respects policy precedence: isLifetime > durationDays > durationMonths", () => {
    const now = new Date();
    // Lifetime takes precedence even if durationDays or durationMonths are set
    const exp1 = calculateExpirationDate(now, {
      isLifetime: true,
      durationDays: 30,
      durationMonths: 1,
    });
    expect(exp1).toBeNull();

    // durationDays takes precedence over durationMonths
    const exp2 = calculateExpirationDate(now, {
      isLifetime: false,
      durationDays: 14,
      durationMonths: 6,
    });
    expect(exp2).toEqual(new Date(now.getTime() + 14 * 86400000));

    // durationMonths applies when durationDays is absent
    const aug31 = new Date(Date.UTC(2026, 7, 31));
    const exp3 = calculateExpirationDate(aug31, {
      isLifetime: false,
      durationMonths: 1,
    });
    expect(exp3?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("issueEntitlementsForOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).prismaGlobal = prisma;
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

  it("issues lifetime entitlement with null expiresAt using OrderItem snapshot", async () => {
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
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: 1,
          licensePlanIdAtPurchase: "plan-life-1",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock)
      .mockResolvedValueOnce(null) // existing check
      .mockResolvedValueOnce({
        id: "ent-1",
        orderId: "ord-1",
        orderItemId: "item-1",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        expiresAt: null,
      }); // after raw insert
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "ent-1" }]);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-1" });

    const result = await issueEntitlementsForOrder("ord-1");

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ENTITLEMENT_CREATED",
        entity: "Entitlement",
      }),
    });

    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].expiresAt).toBeNull();
  });

  it("fails closed when legacy OrderItem is missing snapshotVersion", async () => {
    const mockOrder = {
      id: "ord-legacy",
      orderNumber: "ORD-LEGACY",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-legacy",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-LEGACY",
          variantName: "Legacy",
          productName: "Legacy Theme",
          quantity: 1,
          isLifetime: false,
          durationDays: null,
          durationMonths: null,
          snapshotVersion: null,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-legacy")).rejects.toThrow(
      "Missing entitlement policy snapshot for legacy OrderItem 'item-legacy'",
    );
  });

  it("fails closed when finite plan snapshot has neither durationDays nor durationMonths", async () => {
    const mockOrder = {
      id: "ord-malformed",
      orderNumber: "ORD-MALFORMED",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-malformed",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-BAD",
          variantName: "Bad Plan",
          productName: "Malformed Theme",
          quantity: 1,
          isLifetime: false,
          durationDays: null,
          durationMonths: null,
          maxActivations: 1,
          licensePlanIdAtPurchase: "plan-bad",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-malformed")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-malformed': finite license plan requires positive durationDays or durationMonths",
    );
  });

  it("fails closed when snapshotVersion is unsupported (e.g. version 99)", async () => {
    const mockOrder = {
      id: "ord-unsupported-v",
      orderNumber: "ORD-UNSUPPORTED",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-unsupported",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-V99",
          variantName: "Future Plan",
          productName: "Future Theme",
          quantity: 1,
          isLifetime: false,
          durationDays: 30,
          durationMonths: null,
          licensePlanIdAtPurchase: "plan-future",
          snapshotVersion: 99,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-unsupported-v")).rejects.toThrow(
      "Unsupported entitlement policy snapshot version '99' for OrderItem 'item-unsupported'",
    );
  });

  it("fails closed when maxActivations is non-positive or non-integer", async () => {
    const mockOrder = {
      id: "ord-bad-acts",
      orderNumber: "ORD-BAD-ACTS",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-bad-acts",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-BAD-ACTS",
          variantName: "Bad Activations",
          productName: "Theme",
          quantity: 1,
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: -1,
          licensePlanIdAtPurchase: "plan-bad-acts",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-bad-acts")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-bad-acts': maxActivations must be a positive integer",
    );
  });

  it("fails closed when license plan has null maxActivations", async () => {
    const mockOrder = {
      id: "ord-null-acts",
      orderNumber: "ORD-NULL-ACTS",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-null-acts",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-NULL-ACTS",
          variantName: "Null Activations",
          productName: "Theme",
          quantity: 1,
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: null,
          licensePlanIdAtPurchase: "plan-null-acts",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-null-acts")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-null-acts': maxActivations must be a positive integer",
    );
  });

  it("fails closed when license plan has 0 maxActivations", async () => {
    const mockOrder = {
      id: "ord-zero-acts",
      orderNumber: "ORD-ZERO-ACTS",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-zero-acts",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-ZERO-ACTS",
          variantName: "Zero Activations",
          productName: "Theme",
          quantity: 1,
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: 0,
          licensePlanIdAtPurchase: "plan-zero-acts",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-zero-acts")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-zero-acts': maxActivations must be a positive integer",
    );
  });

  it("fails closed when license plan has float maxActivations", async () => {
    const mockOrder = {
      id: "ord-float-acts",
      orderNumber: "ORD-FLOAT-ACTS",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-float-acts",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-FLOAT-ACTS",
          variantName: "Float Activations",
          productName: "Theme",
          quantity: 1,
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: 2.5,
          licensePlanIdAtPurchase: "plan-float-acts",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-float-acts")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-float-acts': maxActivations must be a positive integer",
    );
  });

  it("fails closed when no-plan snapshot contains polluted license rights", async () => {
    const mockOrder = {
      id: "ord-polluted-noplan",
      orderNumber: "ORD-POLLUTED-NOPLAN",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-polluted-noplan",
          productId: "prod-1",
          variantId: "var-1",
          productType: "THEME",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-POLLUTED",
          variantName: "Polluted Asset",
          productName: "Theme Asset",
          quantity: 1,
          isLifetime: false,
          durationDays: null,
          durationMonths: null,
          maxActivations: 999,
          updatesDays: 365,
          licensePlanIdAtPurchase: null,
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-polluted-noplan")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-polluted-noplan': no-plan snapshot must not contain license rights",
    );
  });

  it("fails closed when updatesDays is non-positive or non-integer", async () => {
    const mockOrder = {
      id: "ord-bad-updates",
      orderNumber: "ORD-BAD-UPDATES",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-bad-updates",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-BAD-UPD",
          variantName: "Bad Updates",
          productName: "Theme",
          quantity: 1,
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: 1,
          updatesDays: 0,
          licensePlanIdAtPurchase: "plan-bad-upd",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-bad-updates")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-bad-updates': updatesDays must be a positive integer or null",
    );
  });

  it("fails closed when supportDays is non-positive or non-integer", async () => {
    const mockOrder = {
      id: "ord-bad-support",
      orderNumber: "ORD-BAD-SUPPORT",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-bad-support",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-BAD-SUP",
          variantName: "Bad Support",
          productName: "Theme",
          quantity: 1,
          isLifetime: true,
          durationDays: null,
          durationMonths: null,
          maxActivations: 1,
          supportDays: -10,
          licensePlanIdAtPurchase: "plan-bad-sup",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

    await expect(issueEntitlementsForOrder("ord-bad-support")).rejects.toThrow(
      "Malformed entitlement policy snapshot for OrderItem 'item-bad-support': supportDays must be a positive integer or null",
    );
  });

  it("calculates typed rights: maxActivations, updatesUntil, supportUntil from OrderItem snapshot", async () => {
    const mockOrder = {
      id: "ord-typed",
      orderNumber: "ORD-TYPED",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-typed",
          productId: "prod-1",
          variantId: "var-1",
          productType: "PLUGIN",
          fulfillmentType: "INTERNAL_LICENSE",
          sku: "SKU-TYPED",
          variantName: "Typed Plan",
          productName: "Plugin Suite",
          quantity: 1,
          isLifetime: false,
          durationDays: 365,
          durationMonths: null,
          maxActivations: 3,
          updatesDays: 365,
          supportDays: 180,
          licensePlanIdAtPurchase: "plan-typed",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "ent-typed",
        orderId: "ord-typed",
        orderItemId: "item-typed",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        maxActivations: 3,
        updatesUntil: new Date(Date.now() + 365 * 86400000),
        supportUntil: new Date(Date.now() + 180 * 86400000),
        expiresAt: new Date(Date.now() + 365 * 86400000),
      });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "ent-typed" }]);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-typed" });

    const result = await issueEntitlementsForOrder("ord-typed");
    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].maxActivations).toBe(3);
    expect(result.entitlements[0].updatesUntil).toBeInstanceOf(Date);
    expect(result.entitlements[0].supportUntil).toBeInstanceOf(Date);
  });

  it("issues perpetual entitlement when item has no license plan (clean no-plan snapshot)", async () => {
    const mockOrder = {
      id: "ord-noplan",
      orderNumber: "ORD-NOPLAN",
      userId: "user-1",
      status: OrderStatus.PAID,
      items: [
        {
          id: "item-noplan",
          productId: "prod-1",
          variantId: "var-1",
          productType: "THEME",
          fulfillmentType: "DIGITAL_DOWNLOAD",
          sku: "SKU-NOPLAN",
          variantName: "Perpetual Asset",
          productName: "Asset Product",
          quantity: 1,
          isLifetime: false,
          durationDays: null,
          durationMonths: null,
          maxActivations: null,
          updatesDays: null,
          supportDays: null,
          licensePlanIdAtPurchase: null,
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "ent-noplan",
        orderId: "ord-noplan",
        orderItemId: "item-noplan",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        expiresAt: null,
        maxActivations: null,
        updatesUntil: null,
        supportUntil: null,
      });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "ent-noplan" }]);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-noplan" });

    const result = await issueEntitlementsForOrder("ord-noplan");
    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].status).toBe(EntitlementStatus.ACTIVE);
    expect(result.entitlements[0].expiresAt).toBeNull();
    expect(result.entitlements[0].maxActivations).toBeNull();
    expect(result.entitlements[0].updatesUntil).toBeNull();
    expect(result.entitlements[0].supportUntil).toBeNull();
  });

  it("issues expiring entitlement with durationDays calculated from snapshot", async () => {
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
          isLifetime: false,
          durationDays: 365,
          durationMonths: null,
          maxActivations: 3,
          licensePlanIdAtPurchase: "plan-year-1",
          snapshotVersion: 1,
        },
      ],
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    (prisma.entitlement.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "ent-2",
        orderId: "ord-2",
        orderItemId: "item-2",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 365 * 86400000),
      });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "ent-2" }]);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-2" });

    const result = await issueEntitlementsForOrder("ord-2");

    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].expiresAt).toBeInstanceOf(Date);
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
          isLifetime: false,
          durationDays: 30,
          snapshotVersion: 1,
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

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].id).toBe("ent-existing");
  });

  it("handles conflict-safe concurrent race via DO NOTHING without throwing P2002", async () => {
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
          isLifetime: false,
          durationDays: 30,
          maxActivations: 1,
          licensePlanIdAtPurchase: "plan-race-1",
          snapshotVersion: 1,
        },
      ],
    };

    const winnerEntitlement = {
      id: "ent-race-winner",
      orderItemId: "item-race",
      status: EntitlementStatus.ACTIVE,
    };

    (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
    // Initially not found before insert, then raw query returns 0 rows (conflict avoided)
    (prisma.entitlement.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winnerEntitlement);

    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]); // ON CONFLICT DO NOTHING returns 0 rows

    const result = await issueEntitlementsForOrder("ord-4");

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(result.issuedCount).toBe(1);
    expect(result.entitlements[0].id).toBe("ent-race-winner");
  });
});

describe("expireDueEntitlements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).prismaGlobal = prisma;
  });

  it("authoritatively transitions due active entitlements to EXPIRED with atomic audit log", async () => {
    const dueRows = [
      {
        id: "ent-expired-1",
        user_id: "user-1",
        order_id: "ord-1",
        order_item_id: "item-1",
      },
    ];

    (prisma.$queryRaw as jest.Mock).mockResolvedValue(dueRows);
    (prisma.entitlement.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-exp-1" });

    const result = await expireDueEntitlements({ workerId: "worker-test" });

    expect(result.expiredCount).toBe(1);
    expect(result.expiredIds).toEqual(["ent-expired-1"]);
    expect(prisma.entitlement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "ent-expired-1",
        status: EntitlementStatus.ACTIVE,
      },
      data: {
        status: EntitlementStatus.EXPIRED,
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ENTITLEMENT_EXPIRED",
        entity: "Entitlement",
        entityId: "ent-expired-1",
        actorId: null,
      }),
    });
  });

  it("returns 0 expired if no due entitlements found", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const result = await expireDueEntitlements();

    expect(result.expiredCount).toBe(0);
    expect(result.expiredIds).toEqual([]);
    expect(prisma.entitlement.updateMany).not.toHaveBeenCalled();
  });
});
