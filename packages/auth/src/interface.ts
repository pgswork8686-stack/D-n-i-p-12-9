import { AuthIdentity } from "@nexus/contracts";

export interface IAuthService {
  /**
   * Verify an authentication token and return external subject/identity.
   * Backend database is the sole authority for user roles & permissions.
   */
  verifyToken(token: string): Promise<AuthIdentity | null>;
  getUserById?(userId: string): Promise<AuthIdentity | null>;
}

