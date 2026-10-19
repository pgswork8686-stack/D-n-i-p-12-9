import type {
  AllocationStatus,
  LicenseAllocationDto,
  LicenseProviderDto,
  PaginatedResponse,
  ProviderAccountDto,
} from "@nexus/contracts";

export const ADMIN_ALLOCATION_PAGE_SIZE = 50;

/** Statuses that need an admin to act (activation requests and deactivation requests). */
export const ADMIN_ALLOCATION_QUEUE_STATUSES: ReadonlyArray<AllocationStatus> = ["PENDING", "DEACTIVATION_PENDING"];

export function adminAllocationQuery(status: AllocationStatus): string {
  const allowed = ADMIN_ALLOCATION_QUEUE_STATUSES.includes(status) ? status : "PENDING";
  return new URLSearchParams({ status: allowed, page: "1", limit: String(ADMIN_ALLOCATION_PAGE_SIZE) }).toString();
}

export function parseAdminAllocationPage(data: unknown): PaginatedResponse<LicenseAllocationDto> {
  if (!data || typeof data !== "object") throw new Error("Invalid allocation response");
  const value = data as Partial<PaginatedResponse<LicenseAllocationDto>>;
  if (!Array.isArray(value.items) || !Number.isSafeInteger(value.total) || (value.total ?? -1) < 0) {
    throw new Error("Invalid paginated allocation response");
  }
  return value as PaginatedResponse<LicenseAllocationDto>;
}

function parseArray<T extends { id: string }>(data: unknown, what: string): T[] {
  if (!Array.isArray(data)) throw new Error("Invalid " + what + " response");
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof (item as T).id !== "string") throw new Error("Invalid " + what + " item");
  }
  return data as T[];
}

export const parseProviderAccounts = (data: unknown) => parseArray<ProviderAccountDto>(data, "provider account");
export const parseProviders = (data: unknown) => parseArray<LicenseProviderDto>(data, "provider");

export function allocationRequestLabel(status: AllocationStatus): string {
  if (status === "PENDING") return "Kích hoạt";
  if (status === "DEACTIVATION_PENDING") return "Hủy kích hoạt";
  return status;
}

/** Percentage of capacity consumed, clamped to 0–100; 0 when capacity is unknown or zero. */
export function accountUsagePercent(account: ProviderAccountDto): number {
  const used = account.consumedAllocationsCount ?? account.activeAllocationsCount ?? 0;
  if (!account.totalCapacity || account.totalCapacity <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / account.totalCapacity) * 100)));
}

export function accountUsedCount(account: ProviderAccountDto): number {
  return account.consumedAllocationsCount ?? account.activeAllocationsCount ?? 0;
}

/** An account may take a new activation only when it is ACTIVE and has free capacity. */
export function canActivateOn(account: ProviderAccountDto): boolean {
  if (account.status !== "ACTIVE") return false;
  if (typeof account.availableCapacity === "number") return account.availableCapacity > 0;
  return accountUsedCount(account) < account.totalCapacity;
}

export function activatableAccounts(accounts: ProviderAccountDto[], providerId: string): ProviderAccountDto[] {
  return accounts.filter(account => account.providerId === providerId && canActivateOn(account));
}

export function providerName(providers: LicenseProviderDto[], providerId: string): string {
  return providers.find(provider => provider.id === providerId)?.name ?? "Nhà cung cấp";
}

export function validateRejectReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 3) return "Vui lòng nhập lý do từ chối (ít nhất 3 ký tự).";
  if (trimmed.length > 500) return "Lý do từ chối tối đa 500 ký tự.";
  return null;
}
