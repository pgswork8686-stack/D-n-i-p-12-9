export interface ProvisionAccountParams {
  domain: string;
  username: string;
  packagePlan: string;
  contactEmail?: string;
}

export interface ProvisionAccountResult {
  success: boolean;
  rawOutput?: any;
  ipAddress?: string;
  nameservers?: string[];
  error?: string;
}

export interface UsageStats {
  diskUsageMb: number;
  diskLimitMb: number;
  bandwidthUsageMb: number;
  bandwidthLimitMb: number;
  inodesUsed?: number;
  inodesLimit?: number;
}

export interface DnsRecordParams {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
}

export interface IHostingAdapter {
  createAccount(server: any, params: ProvisionAccountParams): Promise<ProvisionAccountResult>;
  suspendAccount(server: any, username: string, reason?: string): Promise<boolean>;
  unsuspendAccount(server: any, username: string): Promise<boolean>;
  terminateAccount(server: any, username: string): Promise<boolean>;
  generateSsoUrl(server: any, username: string): Promise<string>;
  getAccountUsage(server: any, username: string): Promise<UsageStats>;
  createDnsRecord?(server: any, domain: string, record: DnsRecordParams): Promise<{ recordId: string }>;
  deleteDnsRecord?(server: any, domain: string, recordId: string): Promise<boolean>;
  purgeCache?(server: any, domain: string, tags?: string[]): Promise<boolean>;
}
