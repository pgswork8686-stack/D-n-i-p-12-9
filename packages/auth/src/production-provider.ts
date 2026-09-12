import { AuthUser } from "@nexus/contracts";
import { IAuthService } from "./interface";

/**
 * Production fail-closed auth provider used when official Supabase Auth
 * is not yet configured or in initial transition phases.
 */
export class ProductionFailClosedAuthProvider implements IAuthService {
  async verifyToken(_token: string): Promise<AuthUser | null> {
    // Fail-closed by design
    return null;
  }

  async getUserById(_userId: string): Promise<AuthUser | null> {
    return null;
  }
}
