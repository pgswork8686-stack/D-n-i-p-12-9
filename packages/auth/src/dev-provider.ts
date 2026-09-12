import { AuthIdentity } from "@nexus/contracts";
import { IAuthService } from "./interface";

/**
 * Development & Test Mock Auth Provider.
 * Strictly for local development and testing before Supabase keys are configured.
 * FAILS CLOSED in production.
 */
export class DevMockAuthProvider implements IAuthService {
  private identities: Map<string, AuthIdentity> = new Map();

  constructor() {
    this.identities.set("dev-admin-token", {
      subject: "sub_dev_admin_001",
      email: "admin@nexustheme.dev",
      metadata: { name: "Admin Developer" },
    });

    this.identities.set("dev-customer-token", {
      subject: "sub_dev_customer_001",
      email: "customer@nexustheme.dev",
      metadata: { name: "Test Customer" },
    });

    // Alias for backwards compatibility with phase 1
    this.identities.set("dev-user-token", {
      subject: "sub_dev_customer_001",
      email: "customer@nexustheme.dev",
      metadata: { name: "Test Customer" },
    });

    this.identities.set("dev-superadmin-token", {
      subject: "sub_dev_superadmin_001",
      email: "superadmin@nexustheme.dev",
      metadata: { name: "Super Administrator" },
    });
  }

  async verifyToken(token: string): Promise<AuthIdentity | null> {
    if (!token) return null;

    // Fail-closed in production
    if (process.env.NODE_ENV === "production") {
      return null;
    }

    if (this.identities.has(token)) {
      return this.identities.get(token) || null;
    }

    // Dynamic mock token support for tests: dev-custom:<subject>:<email>
    if (token.startsWith("dev-custom:")) {
      const parts = token.split(":");
      const subject = parts[1] || "sub_custom";
      const email = parts[2] || `${subject}@test.dev`;
      return {
        subject,
        email,
        metadata: { name: `Custom ${subject}` },
      };
    }

    return null;
  }

  async getUserById(subject: string): Promise<AuthIdentity | null> {
    for (const identity of this.identities.values()) {
      if (identity.subject === subject) {
        return identity;
      }
    }
    return null;
  }
}

