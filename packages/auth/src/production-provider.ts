import { AuthIdentity } from "@nexus/contracts";
import { IAuthService } from "./interface";

/**
 * Production fail-closed auth provider used when official Supabase Auth
 * is not yet configured or fails to initialize.
 */
export class ProductionFailClosedAuthProvider implements IAuthService {
  async verifyToken(_token: string): Promise<AuthIdentity | null> {
    // Fail-closed by design
    return null;
  }

  async getUserById(_userId: string): Promise<AuthIdentity | null> {
    return null;
  }
}

