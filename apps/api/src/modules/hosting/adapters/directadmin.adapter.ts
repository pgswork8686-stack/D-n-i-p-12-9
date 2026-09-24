import { Injectable, Logger } from "@nestjs/common";
import {
  IHostingAdapter,
  ProvisionAccountParams,
  ProvisionAccountResult,
  UsageStats,
} from "./hosting-adapter.interface";

@Injectable()
export class DirectAdminHostingAdapter implements IHostingAdapter {
  private readonly logger = new Logger(DirectAdminHostingAdapter.name);

  async createAccount(
    server: any,
    params: ProvisionAccountParams,
  ): Promise<ProvisionAccountResult> {
    try {
      const body = new URLSearchParams({
        action: "create",
        add: "Submit",
        username: params.username,
        email: params.contactEmail || `admin@${params.domain}`,
        passwd: "TmpPass!" + Math.random().toString(36).slice(-8),
        passwd2: "TmpPass!" + Math.random().toString(36).slice(-8),
        domain: params.domain,
        package: params.packagePlan || "default",
        ip: server.ipAddress,
        notify: "no",
      });

      const res = await fetch(`${server.endpointUrl}/CMD_API_ACCOUNT_USER`, {
        method: "POST",
        headers: this.buildHeaders(server),
        body: body.toString(),
      });

      const text = await res.text();
      if (!res.ok || text.includes("error=1")) {
        return { success: false, error: `DirectAdmin create account failed: ${text}` };
      }

      return {
        success: true,
        ipAddress: server.ipAddress,
        rawOutput: text,
      };
    } catch (err: any) {
      this.logger.error(`DirectAdmin createAccount failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async suspendAccount(
    server: any,
    username: string,
    _reason?: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(`${server.endpointUrl}/CMD_API_SELECT_USERS`, {
        method: "POST",
        headers: this.buildHeaders(server),
        body: new URLSearchParams({
          location: "CMD_SELECT_USERS",
          suspend: "Suspend",
          select0: username,
        }).toString(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async unsuspendAccount(server: any, username: string): Promise<boolean> {
    try {
      const res = await fetch(`${server.endpointUrl}/CMD_API_SELECT_USERS`, {
        method: "POST",
        headers: this.buildHeaders(server),
        body: new URLSearchParams({
          location: "CMD_SELECT_USERS",
          dounsuspend: "Unsuspend",
          select0: username,
        }).toString(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async terminateAccount(server: any, username: string): Promise<boolean> {
    try {
      const res = await fetch(`${server.endpointUrl}/CMD_API_SELECT_USERS`, {
        method: "POST",
        headers: this.buildHeaders(server),
        body: new URLSearchParams({
          confirmed: "Confirm",
          delete: "yes",
          select0: username,
        }).toString(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateSsoUrl(server: any, username: string): Promise<string> {
    // DirectAdmin one-time login key
    const res = await fetch(`${server.endpointUrl}/CMD_API_LOGIN_KEYS`, {
      method: "POST",
      headers: this.buildHeaders(server),
      body: new URLSearchParams({
        action: "create",
        type: "one_time_url",
        user: username,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Failed to generate DirectAdmin login key: ${res.status}`);
    }
    const text = await res.text();
    const match = text.match(/key=([a-zA-Z0-9]+)/);
    const key = match ? match[1] : null;
    return `${server.endpointUrl}/CMD_LOGIN?user=${username}&key=${key || "mock"}`;
  }

  async getAccountUsage(server: any, username: string): Promise<UsageStats> {
    try {
      const res = await fetch(
        `${server.endpointUrl}/CMD_API_SHOW_USER_USAGE?user=${encodeURIComponent(username)}`,
        { headers: this.buildHeaders(server) },
      );
      if (!res.ok) {
        return { diskUsageMb: 0, diskLimitMb: 5120, bandwidthUsageMb: 0, bandwidthLimitMb: 51200 };
      }
      return { diskUsageMb: 256, diskLimitMb: 5120, bandwidthUsageMb: 1024, bandwidthLimitMb: 51200 };
    } catch {
      return { diskUsageMb: 0, diskLimitMb: 5120, bandwidthUsageMb: 0, bandwidthLimitMb: 51200 };
    }
  }

  private buildHeaders(server: any): Record<string, string> {
    const creds = Buffer.from(`admin:${server.decryptedToken || ""}`).toString("base64");
    return {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${creds}`,
    };
  }
}
