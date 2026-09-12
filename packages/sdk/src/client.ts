import {
  HealthCheckResponse,
  AuthMeResponse,
  RoleDetail,
  PermissionDetail,
  AdminUserListItem,
  AuthUser,
} from "@nexus/contracts";

export interface NexusClientConfig {
  baseUrl: string;
  token?: string;
}

export class NexusApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: NexusClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  setToken(token?: string) {
    this.token = token;
  }

  async getHealth(): Promise<HealthCheckResponse> {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Health check failed with status: ${res.status}`);
    }
    return (await res.json()) as HealthCheckResponse;
  }

  async getAuthMe(): Promise<AuthMeResponse> {
    const res = await fetch(`${this.baseUrl}/auth/me`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Auth me failed (${res.status}): ${errorText}`);
    }
    return (await res.json()) as AuthMeResponse;
  }

  async testRbac(level: "customer" | "admin" | "audit"): Promise<any> {
    const res = await fetch(`${this.baseUrl}/rbac/test/${level}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`RBAC test ${level} failed (${res.status}): ${errorText}`);
    }
    return await res.json();
  }

  async listUsers(): Promise<{ status: string; count: number; users: AdminUserListItem[] }> {
    const res = await fetch(`${this.baseUrl}/admin/users`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List users failed (${res.status})`);
    }
    return await res.json();
  }

  async listRoles(): Promise<{ status: string; count: number; roles: RoleDetail[] }> {
    const res = await fetch(`${this.baseUrl}/admin/roles`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List roles failed (${res.status})`);
    }
    return await res.json();
  }

  async listPermissions(): Promise<{ status: string; count: number; permissions: PermissionDetail[] }> {
    const res = await fetch(`${this.baseUrl}/admin/permissions`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List permissions failed (${res.status})`);
    }
    return await res.json();
  }

  async assignRole(userId: string, role: string): Promise<{ status: string; user: AuthUser }> {
    const res = await fetch(`${this.baseUrl}/admin/users/${userId}/roles`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Assign role failed (${res.status}): ${err}`);
    }
    return await res.json();
  }

  async removeRole(userId: string, role: string): Promise<{ status: string; user: AuthUser }> {
    const res = await fetch(`${this.baseUrl}/admin/users/${userId}/roles/${role}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Remove role failed (${res.status}): ${err}`);
    }
    return await res.json();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }
}

