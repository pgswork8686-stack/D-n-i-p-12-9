import type { ProviderAccountDto } from "@nexus/contracts";
import {
  accountUsagePercent, activatableAccounts, adminAllocationQuery, allocationRequestLabel,
  canActivateOn, parseAdminAllocationPage, parseProviderAccounts, validateRejectReason,
} from "../lib/admin-allocations";

const acc = (over: Partial<ProviderAccountDto> = {}): ProviderAccountDto => ({
  id: "a1", providerId: "p1", name: "Agency #1", totalCapacity: 1000, consumedAllocationsCount: 87,
  availableCapacity: 913, status: "ACTIVE", createdAt: "x", updatedAt: "x", ...over,
});

describe("AD13 Admin managed-license allocations helpers", () => {
  it("queries only queue statuses", () => {
    expect(adminAllocationQuery("PENDING")).toContain("status=PENDING");
    expect(adminAllocationQuery("DEACTIVATION_PENDING")).toContain("status=DEACTIVATION_PENDING");
    expect(adminAllocationQuery("ACTIVE" as any)).toContain("status=PENDING");
  });
  it("labels the request type", () => {
    expect(allocationRequestLabel("PENDING")).toBe("Kích hoạt");
    expect(allocationRequestLabel("DEACTIVATION_PENDING")).toBe("Hủy kích hoạt");
  });
  it("rejects malformed responses", () => {
    expect(() => parseAdminAllocationPage({ items: [] })).toThrow();
    expect(() => parseProviderAccounts({})).toThrow();
    expect(() => parseProviderAccounts([{ name: "no id" }])).toThrow();
    expect(parseProviderAccounts([acc()])).toHaveLength(1);
  });
  it("computes usage without inventing numbers", () => {
    expect(accountUsagePercent(acc())).toBe(9);
    expect(accountUsagePercent(acc({ totalCapacity: 0 }))).toBe(0);
    expect(accountUsagePercent(acc({ consumedAllocationsCount: 5000 }))).toBe(100);
  });
  it("allows activation only on ACTIVE accounts with free capacity", () => {
    expect(canActivateOn(acc())).toBe(true);
    expect(canActivateOn(acc({ status: "SUSPENDED" }))).toBe(false);
    expect(canActivateOn(acc({ status: "EXHAUSTED" }))).toBe(false);
    expect(canActivateOn(acc({ availableCapacity: 0 }))).toBe(false);
    expect(canActivateOn(acc({ availableCapacity: undefined, consumedAllocationsCount: 1000 }))).toBe(false);
    const list = [acc(), acc({ id: "a2", providerId: "p2" }), acc({ id: "a3", status: "SUSPENDED" })];
    expect(activatableAccounts(list, "p1").map(a => a.id)).toEqual(["a1"]);
  });
  it("requires a rejection reason", () => {
    expect(validateRejectReason(" ")).not.toBeNull();
    expect(validateRejectReason("Sai tên miền")).toBeNull();
    expect(validateRejectReason("x".repeat(501))).not.toBeNull();
  });
});
