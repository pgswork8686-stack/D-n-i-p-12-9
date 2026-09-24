export type HostingProvider = "CPANEL" | "DIRECTADMIN" | "CLOUDFLARE" | "MOCK";
export type HostingAccountStatus =
  | "PROVISIONING"
  | "ACTIVE"
  | "SUSPENDED"
  | "TERMINATED"
  | "FAILED";
export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX"
  | "NS"
  | "SRV";
export type DnsRecordStatus = "PENDING" | "ACTIVE" | "ERROR" | "DELETED";

export interface HostingServerDto {
  id: string;
  name: string;
  hostname: string;
  provider: HostingProvider;
  endpointUrl: string;
  ipAddress: string;
  maxAccounts: number;
  activeAccounts: number;
  isActive: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostingAccountDto {
  id: string;
  userId: string;
  serverId: string;
  entitlementId?: string | null;
  orderId?: string | null;
  domain: string;
  username: string;
  packagePlan: string;
  status: HostingAccountStatus;
  diskUsageMb: number;
  diskLimitMb: number;
  bandwidthUsageMb: number;
  bandwidthLimitMb: number;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  terminatedAt?: string | null;
  server?: HostingServerDto | null;
  dnsRecords?: HostingDnsRecordDto[];
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostingDnsRecordDto {
  id: string;
  hostingAccountId: string;
  type: DnsRecordType;
  name: string;
  content: string;
  ttl: number;
  priority?: number | null;
  proxied: boolean;
  cloudflareRecordId?: string | null;
  status: DnsRecordStatus;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHostingServerRequest {
  name: string;
  hostname: string;
  provider: HostingProvider;
  endpointUrl: string;
  ipAddress: string;
  apiToken: string;
  maxAccounts?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateHostingServerRequest {
  name?: string;
  hostname?: string;
  endpointUrl?: string;
  ipAddress?: string;
  apiToken?: string;
  maxAccounts?: number;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateHostingAccountRequest {
  serverId?: string;
  domain: string;
  username?: string;
  packagePlan?: string;
  entitlementId?: string;
  orderId?: string;
}

export interface CreateDnsRecordRequest {
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
}

export interface UpdateDnsRecordRequest {
  type?: DnsRecordType;
  name?: string;
  content?: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
}

export interface HostingSsoResponseDto {
  ssoUrl: string;
  expiresAt?: string;
  sessionToken?: string;
}

export interface PurgeCacheRequest {
  purgeEverything?: boolean;
  tags?: string[];
  hosts?: string[];
}

export interface PurgeCacheResponseDto {
  success: boolean;
  message?: string;
}

export interface UsageStatsDto {
  diskUsageMb: number;
  diskLimitMb: number;
  bandwidthUsageMb: number;
  bandwidthLimitMb: number;
  inodesUsed?: number;
  inodesLimit?: number;
}
