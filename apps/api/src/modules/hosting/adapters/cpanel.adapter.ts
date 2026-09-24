import { Injectable, Logger } from "@nestjs/common";
import {
  IHostingAdapter,
  ProvisionAccountParams,
  ProvisionAccountResult,
  UsageStats,
} from "./hosting-adapter.interface";

@Injectable()
export class CpanelHostingAdapter implements IHostingAdapter {
  private readonly logger = new Logger(CpanelHostingAdapter.name);

  async createAccount(
    server: any,
    params: ProvisionAccountParams,
  ): Promise<ProvisionAccountResult> {
    try {
      const url = `${server.endpointUrl}/json-api/createacct?api.version=1&username=${encodeURIComponent(
        params.username,
      )}&domain=${encodeURIComponent(params.domain)}&plan=${encodeURIComponent(
        params.packagePlan || "default",
      )}`;

      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(server),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `cPanel WHM createacct failed (${res.status}): ${text}`,
        };
      }

      const data: any = await res.json();
      const status = data?.metadata?.result;
      if (status !== 1) {
        return {
          success: false,
          error: data?.metadata?.reason || "cPanel WHM account creation returned failure",
        };
      }

      return {
        success: true,
        ipAddress: data?.data?.ip || server.ipAddress,
        nameservers: data?.data?.nameserver ? [data.data.nameserver] : undefined,
        rawOutput: data,
      };
    } catch (err: any) {
      this.logger.error(`cPanel account creation failed for ${params.domain}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async suspendAccount(
    server: any,
    username: string,
    reason = "Payment overdue or entitlement revoked",
  ): Promise<boolean> {
    try {
      const url = `${server.endpointUrl}/json-api/suspendacct?api.version=1&user=${encodeURIComponent(
        username,
      )}&reason=${encodeURIComponent(reason)}`;
      const res = await fetch(url, { method: "POST", headers: this.buildHeaders(server) });
      return res.ok;
    } catch (err: any) {
      this.logger.error(`cPanel suspend failed: ${err.message}`);
      return false;
    }
  }

  async unsuspendAccount(server: any, username: string): Promise<boolean> {
    try {
      const url = `${server.endpointUrl}/json-api/unsuspendacct?api.version=1&user=${encodeURIComponent(
        username,
      )}`;
      const res = await fetch(url, { method: "POST", headers: this.buildHeaders(server) });
      return res.ok;
    } catch (err: any) {
      this.logger.error(`cPanel unsuspend failed: ${err.message}`);
      return false;
    }
  }

  async terminateAccount(server: any, username: string): Promise<boolean> {
    try {
      const url = `${server.endpointUrl}/json-api/killacct?api.version=1&user=${encodeURIComponent(
        username,
      )}`;
      const res = await fetch(url, { method: "POST", headers: this.buildHeaders(server) });
      return res.ok;
    } catch (err: any) {
      this.logger.error(`cPanel terminate failed: ${err.message}`);
      return false;
    }
  }

  async generateSsoUrl(server: any, username: string): Promise<string> {
    const url = `${server.endpointUrl}/json-api/create_user_session?api.version=1&user=${encodeURIComponent(
      username,
    )}&service=cpaneld`;
    const res = await fetch(url, { method: "POST", headers: this.buildHeaders(server) });
    if (!res.ok) {
      throw new Error(`Failed to generate cPanel SSO token: ${res.status}`);
    }
    const data: any = await res.json();
    const sessionUrl = data?.data?.url;
    if (!sessionUrl) {
      throw new Error("cPanel WHM response missing session url");
    }
    return sessionUrl;
  }

  async getAccountUsage(server: any, username: string): Promise<UsageStats> {
    try {
      const url = `${server.endpointUrl}/json-api/accountsummary?api.version=1&user=${encodeURIComponent(
        username,
      )}`;
      const res = await fetch(url, { headers: this.buildHeaders(server) });
      if (!res.ok) {
        return { diskUsageMb: 0, diskLimitMb: 5120, bandwidthUsageMb: 0, bandwidthLimitMb: 51200 };
      }
      const data: any = await res.json();
      const acct = data?.data?.acct?.[0];
      const diskUsed = parseInt(acct?.diskused || "0", 10);
      const diskLimit = parseInt(acct?.disklimit || "5120M", 10) || 5120;
      return {
        diskUsageMb: diskUsed,
        diskLimitMb: diskLimit,
        bandwidthUsageMb: 0,
        bandwidthLimitMb: 51200,
      };
    } catch {
      return { diskUsageMb: 0, diskLimitMb: 5120, bandwidthUsageMb: 0, bandwidthLimitMb: 51200 };
    }
  }

  private buildHeaders(server: any): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `whm root:${server.decryptedToken || ""}`,
    };
  }
}
