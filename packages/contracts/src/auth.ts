export type UserRole = "ADMIN" | "USER" | "MODERATOR";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  expiresAt: number;
}
