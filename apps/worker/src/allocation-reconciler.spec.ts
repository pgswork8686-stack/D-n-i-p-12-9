import { reconcileExternalAllocations } from "./allocation-reconciler";
import * as dbModule from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    reconcileExternalAllocations: jest.fn(),
    prisma: {},
  };
});

describe("Worker - Allocation Reconciler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("delegates to database engineReconcile and returns result", async () => {
    (dbModule.reconcileExternalAllocations as jest.Mock).mockResolvedValue({
      transitionedCount: 2,
      allocationIds: ["alloc-1", "alloc-2"],
    });

    const result = await reconcileExternalAllocations({
      workerId: "test-worker",
      batchSize: 50,
    });

    expect(dbModule.reconcileExternalAllocations).toHaveBeenCalledWith(
      { batchSize: 50, workerId: "test-worker" },
      dbModule.prisma,
    );
    expect(result.transitionedCount).toBe(2);
    expect(result.allocationIds).toEqual(["alloc-1", "alloc-2"]);
  });

  it("handles 0 transitioned allocations gracefully", async () => {
    (dbModule.reconcileExternalAllocations as jest.Mock).mockResolvedValue({
      transitionedCount: 0,
      allocationIds: [],
    });

    const result = await reconcileExternalAllocations();
    expect(result.transitionedCount).toBe(0);
    expect(result.allocationIds).toEqual([]);
  });

  it("propagates error on failure", async () => {
    (dbModule.reconcileExternalAllocations as jest.Mock).mockRejectedValue(
      new Error("Database lock timeout"),
    );

    await expect(reconcileExternalAllocations()).rejects.toThrow(
      "Database lock timeout",
    );
  });
});
