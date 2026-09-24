import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import * as crypto from "crypto";
import {
  prisma,
  HostingServer,
  HostingAccount,
  HostingDnsRecord,
  HostingProvider,
  HostingAccountStatus,
  DnsRecordType,
  DnsRecordStatus,
  isValidHostingTransition,
  calculateUsagePercent,
  isApproachingQuota,
} from "@nexus/database";
import {
  isValidHostingDomain,
  generateHostingUsername,
  isValidDnsRecord,
  encryptHostingCredential,
  decryptHostingCredential,
} from "@nexus/utils";
import {
  HostingServerDto,
  HostingAccountDto,
  HostingDnsRecordDto,
  HostingSsoResponseDto,
  UsageStatsDto,
  PurgeCacheResponseDto,
} from "@nexus/contracts";
import {
  CreateHostingServerDto,
  UpdateHostingServerDto,
  CreateDnsRecordDto,
  UpdateDnsRecordDto,
  PurgeCacheDto,
  AdminSuspendAccountDto,
} from "./dto/hosting.dto";
import { HostingAdapterFactory } from "./adapters/hosting-adapter.factory";

@Injectable()
export class HostingService {
  private readonly logger = new Logger(HostingService.name);

  constructor(private readonly adapterFactory: HostingAdapterFactory) {}

  private getEncryptionKey(): string {
    const raw =
      process.env.HOSTING_ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      "nexus_phase14_hosting_infrastructure_secret_encryption_key_2026";
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  private encryptToken(plaintext: string): string {
    const key = this.getEncryptionKey();
    const result = encryptHostingCredential(plaintext, key);
    return JSON.stringify(result);
  }

  private decryptToken(authEncryptedToken: string): string {
    try {
      const parsed = JSON.parse(authEncryptedToken);
      const key = this.getEncryptionKey();
      return decryptHostingCredential(parsed.encrypted, parsed.iv, parsed.tag, key);
    } catch (err: any) {
      this.logger.warn(`Failed to decrypt hosting server token: ${err.message}`);
      return "";
    }
  }

  private mapServerToDto(server: HostingServer): HostingServerDto {
    return {
      id: server.id,
      name: server.name,
      hostname: server.hostname,
      provider: server.provider as any,
      endpointUrl: server.endpointUrl,
      ipAddress: server.ipAddress,
      maxAccounts: server.maxAccounts,
      activeAccounts: server.activeAccounts,
      isActive: server.isActive,
      metadata: (server.metadata as Record<string, unknown>) || null,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    };
  }

  private mapDnsRecordToDto(record: HostingDnsRecord): HostingDnsRecordDto {
    return {
      id: record.id,
      hostingAccountId: record.hostingAccountId,
      type: record.type as any,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      priority: record.priority,
      proxied: record.proxied,
      cloudflareRecordId: record.cloudflareRecordId,
      status: record.status as any,
      metadata: (record.metadata as Record<string, unknown>) || null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapAccountToDto(
    account: HostingAccount & {
      server?: HostingServer | null;
      dnsRecords?: HostingDnsRecord[];
    },
  ): HostingAccountDto {
    return {
      id: account.id,
      userId: account.userId,
      serverId: account.serverId,
      entitlementId: account.entitlementId,
      orderId: account.orderId,
      domain: account.domain,
      username: account.username,
      packagePlan: account.packagePlan,
      status: account.status as any,
      diskUsageMb: account.diskUsageMb,
      diskLimitMb: account.diskLimitMb,
      bandwidthUsageMb: account.bandwidthUsageMb,
      bandwidthLimitMb: account.bandwidthLimitMb,
      suspendedAt: account.suspendedAt ? account.suspendedAt.toISOString() : null,
      suspensionReason: account.suspensionReason,
      terminatedAt: account.terminatedAt ? account.terminatedAt.toISOString() : null,
      server: account.server ? this.mapServerToDto(account.server) : null,
      dnsRecords: account.dnsRecords
        ? account.dnsRecords.map((r) => this.mapDnsRecordToDto(r))
        : undefined,
      metadata: (account.metadata as Record<string, unknown>) || null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------
  // Customer Operations (Tenant-Isolated)
  // -------------------------------------------------------------

  async listMyAccounts(userId: string): Promise<HostingAccountDto[]> {
    const accounts = await prisma.hostingAccount.findMany({
      where: { userId },
      include: { server: true, dnsRecords: true },
      orderBy: { createdAt: "desc" },
    });
    return accounts.map((acc) => this.mapAccountToDto(acc));
  }

  async getMyAccount(userId: string, accountId: string): Promise<HostingAccountDto> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
      include: { server: true, dnsRecords: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found or access denied");
    }
    return this.mapAccountToDto(account);
  }

  async generateSsoUrl(userId: string, accountId: string): Promise<HostingSsoResponseDto> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }
    if (account.status !== HostingAccountStatus.ACTIVE) {
      throw new BadRequestException(
        `Control panel SSO is not available when account status is '${account.status}'. Account must be ACTIVE.`,
      );
    }
    if (!account.server) {
      throw new NotFoundException("Hosting server configuration not found");
    }

    const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
    const adapter = this.adapterFactory.getAdapter(account.server.provider);
    const ssoUrl = await adapter.generateSsoUrl(
      { ...account.server, decryptedToken },
      account.username,
    );

    return {
      ssoUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async listAccountDnsRecords(
    userId: string,
    accountId: string,
  ): Promise<HostingDnsRecordDto[]> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }
    const records = await prisma.hostingDnsRecord.findMany({
      where: { hostingAccountId: accountId },
      orderBy: { createdAt: "asc" },
    });
    return records.map((r) => this.mapDnsRecordToDto(r));
  }

  async createDnsRecord(
    userId: string,
    accountId: string,
    dto: CreateDnsRecordDto,
  ): Promise<HostingDnsRecordDto> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }
    if (account.status === HostingAccountStatus.TERMINATED) {
      throw new BadRequestException("Cannot manage DNS for a terminated hosting account");
    }

    const validation = isValidDnsRecord(dto.type, dto.name, dto.content, dto.priority);
    if (!validation.isValid) {
      throw new BadRequestException(validation.error || "Invalid DNS record payload");
    }

    const existing = await prisma.hostingDnsRecord.findFirst({
      where: {
        hostingAccountId: accountId,
        type: dto.type,
        name: dto.name.toLowerCase().trim(),
        content: dto.content.trim(),
      },
    });
    if (existing) {
      throw new ConflictException("An identical DNS record already exists for this domain");
    }

    let externalRecordId: string | undefined;
    if (account.server) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const cfAdapter = this.adapterFactory.getCloudflareAdapter();
      const res = await cfAdapter.createDnsRecord(
        { ...account.server, decryptedToken },
        account.domain,
        dto,
      );
      externalRecordId = res?.recordId;
    }

    const created = await prisma.hostingDnsRecord.create({
      data: {
        hostingAccountId: accountId,
        type: dto.type,
        name: dto.name.toLowerCase().trim(),
        content: dto.content.trim(),
        ttl: dto.ttl || 3600,
        priority: dto.priority,
        proxied: Boolean(dto.proxied),
        cloudflareRecordId: externalRecordId,
        status: DnsRecordStatus.ACTIVE,
      },
    });

    return this.mapDnsRecordToDto(created);
  }

  async updateDnsRecord(
    userId: string,
    accountId: string,
    recordId: string,
    dto: UpdateDnsRecordDto,
  ): Promise<HostingDnsRecordDto> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }

    const record = await prisma.hostingDnsRecord.findFirst({
      where: { id: recordId, hostingAccountId: accountId },
    });
    if (!record) {
      throw new NotFoundException("DNS record not found");
    }

    const newType = dto.type || record.type;
    const newName = dto.name !== undefined ? dto.name : record.name;
    const newContent = dto.content !== undefined ? dto.content : record.content;
    const newPriority = dto.priority !== undefined ? dto.priority : record.priority;

    const validation = isValidDnsRecord(newType, newName, newContent, newPriority);
    if (!validation.isValid) {
      throw new BadRequestException(validation.error || "Invalid DNS record payload");
    }

    const updated = await prisma.hostingDnsRecord.update({
      where: { id: recordId },
      data: {
        type: dto.type ? dto.type : undefined,
        name: dto.name ? dto.name.toLowerCase().trim() : undefined,
        content: dto.content ? dto.content.trim() : undefined,
        ttl: dto.ttl !== undefined ? dto.ttl : undefined,
        priority: dto.priority !== undefined ? dto.priority : undefined,
        proxied: dto.proxied !== undefined ? dto.proxied : undefined,
      },
    });

    return this.mapDnsRecordToDto(updated);
  }

  async deleteDnsRecord(
    userId: string,
    accountId: string,
    recordId: string,
  ): Promise<{ success: boolean }> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }

    const record = await prisma.hostingDnsRecord.findFirst({
      where: { id: recordId, hostingAccountId: accountId },
    });
    if (!record) {
      throw new NotFoundException("DNS record not found");
    }

    if (account.server && record.cloudflareRecordId) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const cfAdapter = this.adapterFactory.getCloudflareAdapter();
      await cfAdapter.deleteDnsRecord(
        { ...account.server, decryptedToken },
        account.domain,
        record.cloudflareRecordId,
      );
    }

    await prisma.hostingDnsRecord.delete({
      where: { id: recordId },
    });

    return { success: true };
  }

  async purgeCdnCache(
    userId: string,
    accountId: string,
    dto: PurgeCacheDto,
  ): Promise<PurgeCacheResponseDto> {
    const account = await prisma.hostingAccount.findFirst({
      where: { id: accountId, userId },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }
    if (account.status !== HostingAccountStatus.ACTIVE) {
      throw new BadRequestException("CDN cache purge is only available for active hosting accounts");
    }

    if (account.server) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const cfAdapter = this.adapterFactory.getCloudflareAdapter();
      await cfAdapter.purgeCache(
        { ...account.server, decryptedToken },
        account.domain,
        dto.tags,
      );
    }

    return {
      success: true,
      message: "CDN cache purge command executed successfully",
    };
  }

  // -------------------------------------------------------------
  // Admin Operations
  // -------------------------------------------------------------

  async adminListServers(): Promise<HostingServerDto[]> {
    const servers = await prisma.hostingServer.findMany({
      orderBy: { createdAt: "desc" },
    });
    return servers.map((s) => this.mapServerToDto(s));
  }

  async adminGetServer(id: string): Promise<HostingServerDto> {
    const server = await prisma.hostingServer.findUnique({
      where: { id },
    });
    if (!server) {
      throw new NotFoundException("Hosting server not found");
    }
    return this.mapServerToDto(server);
  }

  async adminCreateServer(dto: CreateHostingServerDto): Promise<HostingServerDto> {
    const existing = await prisma.hostingServer.findUnique({
      where: { hostname: dto.hostname },
    });
    if (existing) {
      throw new ConflictException(`Hosting server with hostname '${dto.hostname}' already exists`);
    }

    const authEncryptedToken = this.encryptToken(dto.apiToken);

    const server = await prisma.hostingServer.create({
      data: {
        name: dto.name,
        hostname: dto.hostname,
        provider: dto.provider,
        endpointUrl: dto.endpointUrl,
        ipAddress: dto.ipAddress,
        maxAccounts: dto.maxAccounts || 100,
        authEncryptedToken,
        metadata: (dto.metadata as any) || undefined,
      },
    });

    return this.mapServerToDto(server);
  }

  async adminUpdateServer(id: string, dto: UpdateHostingServerDto): Promise<HostingServerDto> {
    const server = await prisma.hostingServer.findUnique({
      where: { id },
    });
    if (!server) {
      throw new NotFoundException("Hosting server not found");
    }

    let authEncryptedToken: string | undefined;
    if (dto.apiToken) {
      authEncryptedToken = this.encryptToken(dto.apiToken);
    }

    const updated = await prisma.hostingServer.update({
      where: { id },
      data: {
        name: dto.name,
        hostname: dto.hostname,
        endpointUrl: dto.endpointUrl,
        ipAddress: dto.ipAddress,
        maxAccounts: dto.maxAccounts,
        isActive: dto.isActive,
        authEncryptedToken,
        metadata: (dto.metadata as any) || undefined,
      },
    });

    return this.mapServerToDto(updated);
  }

  async adminDeleteServer(id: string): Promise<{ success: boolean }> {
    const server = await prisma.hostingServer.findUnique({
      where: { id },
      include: { accounts: true },
    });
    if (!server) {
      throw new NotFoundException("Hosting server not found");
    }
    if (server.accounts.length > 0) {
      throw new BadRequestException(
        `Cannot delete hosting server: ${server.accounts.length} hosting accounts are still assigned to it.`,
      );
    }

    await prisma.hostingServer.delete({
      where: { id },
    });
    return { success: true };
  }

  async adminListAccounts(query?: {
    serverId?: string;
    status?: HostingAccountStatus;
    userId?: string;
  }): Promise<HostingAccountDto[]> {
    const accounts = await prisma.hostingAccount.findMany({
      where: {
        serverId: query?.serverId,
        status: query?.status,
        userId: query?.userId,
      },
      include: { server: true, dnsRecords: true },
      orderBy: { createdAt: "desc" },
    });
    return accounts.map((acc) => this.mapAccountToDto(acc));
  }

  async adminGetAccount(id: string): Promise<HostingAccountDto> {
    const account = await prisma.hostingAccount.findUnique({
      where: { id },
      include: { server: true, dnsRecords: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }
    return this.mapAccountToDto(account);
  }

  async adminSuspendAccount(id: string, dto: AdminSuspendAccountDto): Promise<HostingAccountDto> {
    const account = await prisma.hostingAccount.findUnique({
      where: { id },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }

    if (!isValidHostingTransition(account.status, HostingAccountStatus.SUSPENDED)) {
      throw new BadRequestException(
        `Invalid status transition from '${account.status}' to '${HostingAccountStatus.SUSPENDED}'`,
      );
    }

    if (account.server) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const adapter = this.adapterFactory.getAdapter(account.server.provider);
      await adapter.suspendAccount(
        { ...account.server, decryptedToken },
        account.username,
        dto.reason,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const acc = await tx.hostingAccount.update({
        where: { id },
        data: {
          status: HostingAccountStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspensionReason: dto.reason || "Suspended by administrator",
        },
        include: { server: true, dnsRecords: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "HOSTING_ACCOUNT_SUSPENDED",
          aggregateType: "HostingAccount",
          aggregateId: id,
          payload: {
            accountId: id,
            domain: acc.domain,
            userId: acc.userId,
            reason: acc.suspensionReason,
          },
          status: "PENDING",
        },
      });

      return acc;
    });

    return this.mapAccountToDto(updated);
  }

  async adminUnsuspendAccount(id: string): Promise<HostingAccountDto> {
    const account = await prisma.hostingAccount.findUnique({
      where: { id },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }

    if (!isValidHostingTransition(account.status, HostingAccountStatus.ACTIVE)) {
      throw new BadRequestException(
        `Invalid status transition from '${account.status}' to '${HostingAccountStatus.ACTIVE}'`,
      );
    }

    if (account.server) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const adapter = this.adapterFactory.getAdapter(account.server.provider);
      await adapter.unsuspendAccount({ ...account.server, decryptedToken }, account.username);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const acc = await tx.hostingAccount.update({
        where: { id },
        data: {
          status: HostingAccountStatus.ACTIVE,
          suspendedAt: null,
          suspensionReason: null,
        },
        include: { server: true, dnsRecords: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "HOSTING_ACCOUNT_UNSUSPENDED",
          aggregateType: "HostingAccount",
          aggregateId: id,
          payload: {
            accountId: id,
            domain: acc.domain,
            userId: acc.userId,
          },
          status: "PENDING",
        },
      });

      return acc;
    });

    return this.mapAccountToDto(updated);
  }

  async adminTerminateAccount(id: string): Promise<HostingAccountDto> {
    const account = await prisma.hostingAccount.findUnique({
      where: { id },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }

    if (!isValidHostingTransition(account.status, HostingAccountStatus.TERMINATED)) {
      throw new BadRequestException(
        `Invalid status transition from '${account.status}' to '${HostingAccountStatus.TERMINATED}'`,
      );
    }

    if (account.server) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const adapter = this.adapterFactory.getAdapter(account.server.provider);
      await adapter.terminateAccount({ ...account.server, decryptedToken }, account.username);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const acc = await tx.hostingAccount.update({
        where: { id },
        data: {
          status: HostingAccountStatus.TERMINATED,
          terminatedAt: new Date(),
        },
        include: { server: true, dnsRecords: true },
      });

      if (account.serverId) {
        await tx.hostingServer.update({
          where: { id: account.serverId },
          data: {
            activeAccounts: {
              decrement: account.status === HostingAccountStatus.ACTIVE ? 1 : 0,
            },
          },
        });
      }

      await tx.outboxEvent.create({
        data: {
          eventType: "HOSTING_ACCOUNT_TERMINATED",
          aggregateType: "HostingAccount",
          aggregateId: id,
          payload: {
            accountId: id,
            domain: acc.domain,
            userId: acc.userId,
          },
          status: "PENDING",
        },
      });

      return acc;
    });

    return this.mapAccountToDto(updated);
  }

  async adminRetryProvision(id: string): Promise<HostingAccountDto> {
    const account = await prisma.hostingAccount.findUnique({
      where: { id },
      include: { server: true },
    });
    if (!account) {
      throw new NotFoundException("Hosting account not found");
    }
    if (account.status === HostingAccountStatus.ACTIVE) {
      throw new BadRequestException("Account is already active");
    }
    if (account.status === HostingAccountStatus.TERMINATED) {
      throw new BadRequestException("Cannot retry provisioning on a terminated account");
    }

    return this.provisionAccountInternal({
      userId: account.userId,
      domain: account.domain,
      serverId: account.serverId,
      username: account.username,
      packagePlan: account.packagePlan,
      entitlementId: account.entitlementId || undefined,
      orderId: account.orderId || undefined,
    });
  }

  // -------------------------------------------------------------
  // Internal Authoritative Provisioning Logic
  // -------------------------------------------------------------

  async provisionAccountInternal(params: {
    userId: string;
    domain: string;
    serverId?: string;
    username?: string;
    packagePlan?: string;
    entitlementId?: string;
    orderId?: string;
  }): Promise<HostingAccountDto> {
    if (!isValidHostingDomain(params.domain)) {
      throw new BadRequestException(
        `Invalid hosting domain '${params.domain}'. Must be a valid fully qualified domain name (FQDN).`,
      );
    }

    const cleanDomain = params.domain.trim().toLowerCase();

    // Check existing account with domain
    const existingDomain = await prisma.hostingAccount.findUnique({
      where: { domain: cleanDomain },
    });

    if (existingDomain && existingDomain.status === HostingAccountStatus.ACTIVE) {
      throw new ConflictException(`Domain '${cleanDomain}' is already hosted on an active account`);
    }

    // Determine target server
    let server: HostingServer | null = null;
    if (params.serverId) {
      server = await prisma.hostingServer.findUnique({
        where: { id: params.serverId },
      });
      if (!server || !server.isActive) {
        throw new BadRequestException("Specified hosting server is inactive or does not exist");
      }
    } else {
      // Pick active server with available capacity
      server = await prisma.hostingServer.findFirst({
        where: {
          isActive: true,
          activeAccounts: { lt: prisma.hostingServer.fields.maxAccounts },
        },
        orderBy: { activeAccounts: "asc" },
      });

      if (!server) {
        // Fallback to any active server
        server = await prisma.hostingServer.findFirst({
          where: { isActive: true },
          orderBy: { activeAccounts: "asc" },
        });
      }

      // If still no server in the entire system, provision a default mock server
      if (!server) {
        const encryptedMock = this.encryptToken("mock-system-token-default");
        server = await prisma.hostingServer.create({
          data: {
            name: "Default Nexus Cloud Node 1",
            hostname: "cloud1.nexusnode.net",
            provider: HostingProvider.MOCK,
            endpointUrl: "https://cloud1.nexusnode.net:2083",
            ipAddress: "192.0.2.10",
            maxAccounts: 500,
            activeAccounts: 0,
            authEncryptedToken: encryptedMock,
            isActive: true,
          },
        });
      }
    }

    const username = params.username || generateHostingUsername(cleanDomain);

    // Upsert / Create account record in PROVISIONING state
    let account = existingDomain;
    if (!account) {
      account = await prisma.hostingAccount.create({
        data: {
          userId: params.userId,
          serverId: server.id,
          domain: cleanDomain,
          username,
          packagePlan: params.packagePlan || "starter",
          entitlementId: params.entitlementId,
          orderId: params.orderId,
          status: HostingAccountStatus.PROVISIONING,
          diskLimitMb: 5120,
          bandwidthLimitMb: 51200,
        },
      });
    } else {
      account = await prisma.hostingAccount.update({
        where: { id: account.id },
        data: {
          serverId: server.id,
          username,
          status: HostingAccountStatus.PROVISIONING,
        },
      });
    }

    const decryptedToken = this.decryptToken(server.authEncryptedToken);
    const adapter = this.adapterFactory.getAdapter(server.provider);

    const provisionResult = await adapter.createAccount(
      { ...server, decryptedToken },
      {
        domain: cleanDomain,
        username,
        packagePlan: account.packagePlan,
      },
    );

    if (provisionResult.success) {
      // Transition to ACTIVE
      const updated = await prisma.$transaction(async (tx) => {
        const acc = await tx.hostingAccount.update({
          where: { id: account!.id },
          data: {
            status: HostingAccountStatus.ACTIVE,
          },
          include: { server: true, dnsRecords: true },
        });

        await tx.hostingServer.update({
          where: { id: server!.id },
          data: {
            activeAccounts: { increment: 1 },
          },
        });

        // Seed default DNS records (Apex A & www CNAME)
        await tx.hostingDnsRecord.createMany({
          data: [
            {
              hostingAccountId: acc.id,
              type: DnsRecordType.A,
              name: "@",
              content: provisionResult.ipAddress || server!.ipAddress,
              ttl: 3600,
              proxied: true,
              status: DnsRecordStatus.ACTIVE,
            },
            {
              hostingAccountId: acc.id,
              type: DnsRecordType.CNAME,
              name: "www",
              content: cleanDomain,
              ttl: 3600,
              proxied: true,
              status: DnsRecordStatus.ACTIVE,
            },
          ],
          skipDuplicates: true,
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "HOSTING_ACCOUNT_PROVISIONED",
            aggregateType: "HostingAccount",
            aggregateId: acc.id,
            payload: {
              accountId: acc.id,
              domain: acc.domain,
              username: acc.username,
              userId: acc.userId,
              serverId: server!.id,
            },
            status: "PENDING",
          },
        });

        return acc;
      });

      // Refetch with dns records
      const fullAccount = await prisma.hostingAccount.findUnique({
        where: { id: updated.id },
        include: { server: true, dnsRecords: true },
      });

      return this.mapAccountToDto(fullAccount!);
    } else {
      // Mark as FAILED
      const failed = await prisma.$transaction(async (tx) => {
        const acc = await tx.hostingAccount.update({
          where: { id: account!.id },
          data: {
            status: HostingAccountStatus.FAILED,
            metadata: {
              provisionError: provisionResult.error || "Provisioning adapter failed",
            },
          },
          include: { server: true, dnsRecords: true },
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "HOSTING_ACCOUNT_FAILED",
            aggregateType: "HostingAccount",
            aggregateId: acc.id,
            payload: {
              accountId: acc.id,
              domain: acc.domain,
              userId: acc.userId,
              error: provisionResult.error,
            },
            status: "PENDING",
          },
        });

        return acc;
      });

      return this.mapAccountToDto(failed);
    }
  }

  async syncAccountUsage(accountId: string): Promise<UsageStatsDto> {
    const account = await prisma.hostingAccount.findUnique({
      where: { id: accountId },
      include: { server: true },
    });
    if (!account || !account.server) {
      throw new NotFoundException("Hosting account or server not found");
    }

    const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
    const adapter = this.adapterFactory.getAdapter(account.server.provider);
    const usage = await adapter.getAccountUsage(
      { ...account.server, decryptedToken },
      account.username,
    );

    await prisma.hostingAccount.update({
      where: { id: accountId },
      data: {
        diskUsageMb: usage.diskUsageMb,
        diskLimitMb: usage.diskLimitMb,
        bandwidthUsageMb: usage.bandwidthUsageMb,
        bandwidthLimitMb: usage.bandwidthLimitMb,
      },
    });

    return usage;
  }

  async suspendAccountForRevocation(entitlementId: string, reason?: string): Promise<boolean> {
    const account = await prisma.hostingAccount.findFirst({
      where: { entitlementId },
      include: { server: true },
    });
    if (!account || account.status !== HostingAccountStatus.ACTIVE) {
      return false;
    }

    if (account.server) {
      const decryptedToken = this.decryptToken(account.server.authEncryptedToken);
      const adapter = this.adapterFactory.getAdapter(account.server.provider);
      await adapter.suspendAccount(
        { ...account.server, decryptedToken },
        account.username,
        reason || "Entitlement revoked or expired",
      );
    }

    await prisma.hostingAccount.update({
      where: { id: account.id },
      data: {
        status: HostingAccountStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: reason || "Entitlement revoked or expired",
      },
    });

    return true;
  }
}
