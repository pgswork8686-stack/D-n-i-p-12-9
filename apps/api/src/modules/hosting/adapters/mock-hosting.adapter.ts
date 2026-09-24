import { Injectable } from "@nestjs/common";
import {
  IHostingAdapter,
  ProvisionAccountParams,
  ProvisionAccountResult,
  UsageStats,
  DnsRecordParams,
} from "./hosting-adapter.interface";

@Injectable()
export class MockHostingAdapter implements IHostingAdapter {
  async createAccount(
    server: any,
    params: ProvisionAccountParams,
  ): Promise<ProvisionAccountResult> {
    return {
      success: true,
      ipAddress: server.ipAddress || "192.0.2.100",
      nameservers: [`ns1.${server.hostname}`, `ns2.${server.hostname}`],
      rawOutput: { status: "created", user: params.username },
    };
  }

  async suspendAccount(
    _server: any,
    _username: string,
    _reason?: string,
  ): Promise<boolean> {
    return true;
  }

  async unsuspendAccount(_server: any, _username: string): Promise<boolean> {
    return true;
  }

  async terminateAccount(_server: any, _username: string): Promise<boolean> {
    return true;
  }

  async generateSsoUrl(server: any, username: string): Promise<string> {
    const sessionToken = `mock_sso_${Date.now()}`;
    return `https://${server.hostname}:2083/cpsess_${sessionToken}/login?user=${username}`;
  }

  async getAccountUsage(_server: any, _username: string): Promise<UsageStats> {
    return {
      diskUsageMb: 512,
      diskLimitMb: 5120,
      bandwidthUsageMb: 2048,
      bandwidthLimitMb: 51200,
    };
  }

  async createDnsRecord(
    _server: any,
    _domain: string,
    _record: DnsRecordParams,
  ): Promise<{ recordId: string }> {
    return { recordId: `rec_mock_${Date.now()}` };
  }

  async deleteDnsRecord(
    _server: any,
    _domain: string,
    _recordId: string,
  ): Promise<boolean> {
    return true;
  }

  async purgeCache(_server: any, _domain: string, _tags?: string[]): Promise<boolean> {
    return true;
  }
}
