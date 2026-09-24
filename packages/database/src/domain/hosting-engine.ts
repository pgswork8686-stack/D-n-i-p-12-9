import { HostingAccountStatus, DnsRecordStatus } from "@prisma/client";

/**
 * Valid forward lifecycle transitions for Hosting Accounts.
 * Terminal state is TERMINATED.
 */
const ALLOWED_HOSTING_TRANSITIONS: Record<HostingAccountStatus, HostingAccountStatus[]> = {
  PROVISIONING: [HostingAccountStatus.ACTIVE, HostingAccountStatus.FAILED],
  ACTIVE: [HostingAccountStatus.SUSPENDED, HostingAccountStatus.TERMINATED],
  SUSPENDED: [HostingAccountStatus.ACTIVE, HostingAccountStatus.TERMINATED],
  FAILED: [HostingAccountStatus.PROVISIONING, HostingAccountStatus.TERMINATED],
  TERMINATED: [], // Terminal
};

export function isValidHostingTransition(
  from: HostingAccountStatus,
  to: HostingAccountStatus,
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_HOSTING_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Calculates consumption percentage (0 - 100) with safe divide-by-zero protection.
 */
export function calculateUsagePercent(usedMb: number, limitMb: number): number {
  if (limitMb <= 0 || usedMb <= 0) return 0;
  const raw = (usedMb / limitMb) * 100;
  return Math.min(100, Math.round(raw * 10) / 10);
}

/**
 * Checks whether an account is approaching its quota threshold.
 */
export function isApproachingQuota(
  usedMb: number,
  limitMb: number,
  thresholdPercent = 85,
): boolean {
  return calculateUsagePercent(usedMb, limitMb) >= thresholdPercent;
}

/**
 * Validates DNS Record transition states.
 */
export function isValidDnsRecordTransition(
  from: DnsRecordStatus,
  to: DnsRecordStatus,
): boolean {
  if (from === to) return true;
  if (from === DnsRecordStatus.DELETED) return false;
  return true;
}
