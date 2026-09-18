import { EntitlementDto, CustomerAllocationDto, OrderDto } from "@nexus/contracts";

export interface EntitlementActionCta {
  label: string;
  href: string;
}

export function resolveEntitlementActionCta(
  fulfillmentType?: string | null,
): EntitlementActionCta | null {
  if (fulfillmentType === "INTERNAL_LICENSE") {
    return { label: "View License Keys 🔑", href: "/licenses" };
  }
  if (fulfillmentType === "EXTERNAL_MANAGED") {
    return { label: "Manage Domain Allocations 🌐", href: "/allocations" };
  }
  return null;
}

export interface EntitlementAllocations {
  entitlement: EntitlementDto;
  allocations: CustomerAllocationDto[];
}

export function filterExternalManagedEntitlements(
  entitlements: EntitlementDto[],
): EntitlementDto[] {
  return entitlements.filter(
    (e) => e.fulfillmentType === "EXTERNAL_MANAGED" && e.status === "ACTIVE",
  );
}

export async function loadAllocationsForEntitlements(
  client: { listAllocations: (id: string) => Promise<CustomerAllocationDto[]> },
  entitlements: EntitlementDto[],
): Promise<EntitlementAllocations[]> {
  const externalEntitlements = filterExternalManagedEntitlements(entitlements);
  const loaded: EntitlementAllocations[] = [];
  for (const ent of externalEntitlements) {
    try {
      const allocs = await client.listAllocations(ent.id);
      loaded.push({ entitlement: ent, allocations: allocs || [] });
    } catch {
      loaded.push({ entitlement: ent, allocations: [] });
    }
  }
  return loaded;
}

export async function executeDomainDeactivation(
  client: { deactivateLicenseDomain: (licenseId: string, domain: string) => Promise<any> },
  licenseId: string,
  domain: string,
): Promise<any> {
  return await client.deactivateLicenseDomain(licenseId, domain);
}

export async function executeLicenseReveal(
  client: { revealLicense: (licenseId: string) => Promise<{ licenseKey: string }> },
  licenseId: string,
): Promise<string> {
  const res = await client.revealLicense(licenseId);
  return res.licenseKey;
}

export async function syncPaymentResultStatus(
  client: { getOrder: (orderId: string) => Promise<OrderDto> },
  orderId: string,
): Promise<OrderDto> {
  return await client.getOrder(orderId);
}
