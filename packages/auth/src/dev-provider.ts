import { AuthUser } from "@nexus/contracts";
import { IAuthService } from "./interface";

/**
 * Development & Test Mock Auth Provider.
 * strictly for local development and testing before Supabase keys are configured.
 */
export class DevMockAuthProvider implements IAuthService {
  private users: Map<string, AuthUser> = new Map();

  constructor() {
    // Default seeded local dev users
    this.users.set("dev-admin-id", {
      id: "dev-admin-id",
      email: "admin@nexustheme.dev",
      role: "ADMIN",
      name: "Admin Developer",
    });

    this.users.set("dev-user-id", {
      id: "dev-user-id",
      email: "user@nexustheme.dev",
      role: "USER",
      name: "Test Customer",
    });
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    if (!token) return null;
    // Fail-closed in production
    if (process.env.NODE_ENV === "production") {
      return null;
    }
    if (token === "dev-admin-token") {
      return this.users.get("dev-admin-id") || null;
    }
    if (token === "dev-user-token") {
      return this.users.get("dev-user-id") || null;
    }
    return null;
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    return this.users.get(userId) || null;
  }
}
