import { AuthUser } from "@nexus/contracts";

export interface IAuthService {
  verifyToken(token: string): Promise<AuthUser | null>;
  getUserById(userId: string): Promise<AuthUser | null>;
}
