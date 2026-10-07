import { Injectable, Logger } from "@nestjs/common";
import { DnsRecordParams } from "./hosting-adapter.interface";

/**
 * Cloudflare DNS v4 adapter.
 *
 * Production is fail-closed: a missing zone id/token or any non-2xx answer is
 * reported as a failure. Outside production (no real zone configured) the
 * adapter simulates success so local flows and acceptance suites can run.
 */
@Injectable()
export class CloudflareHostingAdapter {
  private readonly logger = new Logger(CloudflareHostingAdapter.name);

  private canSimulate(server: any): boolean {
    return (
      process.env.NODE_ENV !== "production" &&
      (!server.metadata?.zoneId || !server.decryptedToken)
    );
  }

  private requireZone(server: any): string {
    const zoneId = server.metadata?.zoneId;
    if (!zoneId || !server.decryptedToken) {
      throw new Error("Cloudflare zoneId and API token must be configured for this server");
    }
    return zoneId;
  }

  async createDnsRecord(
    server: any,
    domain: string,
    record: DnsRecordParams,
  ): Promise<{ recordId: string }> {
    if (this.canSimulate(server)) {
      return { recordId: `rec_sim_${Date.now()}` };
    }
    const zoneId = this.requireZone(server);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        headers: this.buildHeaders(server),
        body: JSON.stringify({
          type: record.type,
          name: record.name === "@" ? domain : `${record.name}.${domain}`,
          content: record.content,
          ttl: record.ttl || 3600,
          priority: record.priority,
          proxied: Boolean(record.proxied),
        }),
      },
    );
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data?.result?.id) {
      this.logger.error(`Cloudflare DNS create failed (${res.status}) for ${domain}`);
      throw new Error("Cloudflare DNS record creation failed");
    }
    return { recordId: data.result.id };
  }

  async deleteDnsRecord(
    server: any,
    _domain: string,
    recordId: string,
  ): Promise<boolean> {
    if (this.canSimulate(server)) return true;
    const zoneId = this.requireZone(server);
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`,
        { method: "DELETE", headers: this.buildHeaders(server) },
      );
      return res.ok;
    } catch (err: any) {
      this.logger.error(`Cloudflare DNS delete failed: ${err.message}`);
      return false;
    }
  }

  async purgeCache(server: any, _domain: string, tags?: string[]): Promise<boolean> {
    if (this.canSimulate(server)) return true;
    const zoneId = this.requireZone(server);
    try {
      const body = tags && tags.length > 0 ? { tags } : { purge_everything: true };
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: "POST",
          headers: this.buildHeaders(server),
          body: JSON.stringify(body),
        },
      );
      return res.ok;
    } catch (err: any) {
      this.logger.error(`Cloudflare cache purge failed: ${err.message}`);
      return false;
    }
  }

  private buildHeaders(server: any): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${server.decryptedToken}`,
    };
  }
}
