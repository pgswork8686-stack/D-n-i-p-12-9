import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AuthIdentity } from "@nexus/contracts";
import { IAuthService } from "./interface";

export interface SupabaseAuthConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export class SupabaseAuthProvider implements IAuthService {
  private client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new Error("SupabaseAuthProvider requires supabaseUrl and supabaseServiceRoleKey");
    }

    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async verifyToken(token: string): Promise<AuthIdentity | null> {
    if (!token) return null;

    try {
      const { data, error } = await this.client.auth.getUser(token);
      if (error || !data?.user) {
        return null;
      }

      const user = data.user;
      const emailVerified = Boolean(
        user.email_confirmed_at ||
        (user as any).confirmed_at ||
        user.user_metadata?.email_verified ||
        user.app_metadata?.email_verified,
      );

      return {
        subject: user.id,
        email: user.email || null,
        emailVerified,
        phone: user.phone || null,
        metadata: user.user_metadata || {},
      };
    } catch {
      return null;
    }
  }

  async getUserById(subject: string): Promise<AuthIdentity | null> {
    try {
      const { data, error } = await this.client.auth.admin.getUserById(subject);
      if (error || !data?.user) {
        return null;
      }

      const user = data.user;
      const emailVerified = Boolean(
        user.email_confirmed_at ||
        (user as any).confirmed_at ||
        user.user_metadata?.email_verified ||
        user.app_metadata?.email_verified,
      );

      return {
        subject: data.user.id,
        email: data.user.email || null,
        emailVerified,
        phone: data.user.phone || null,
        metadata: data.user.user_metadata || {},
      };
    } catch {
      return null;
    }
  }
}