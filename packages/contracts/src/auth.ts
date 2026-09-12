export interface UserProfile {
  id: string;
  userId: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
}

export interface AuthUser {
  id: string;
  email?: string | null;
  supabaseId?: string | null;
  roles: string[];
  permissions: string[];
  profile?: UserProfile | null;
}

export interface AuthIdentity {
  subject: string;
  email?: string | null;
  emailVerified?: boolean;
  phone?: string | null;
  metadata?: Record<string, any>;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  expiresAt: number;
}

export interface AuthMeResponse {
  id: string;
  email?: string | null;
  profile: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
  };
  roles: string[];
  permissions: string[];
}

export interface RoleDetail {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export interface PermissionDetail {
  id: string;
  name: string;
  displayName: string | null;
  module: string | null;
  description: string | null;
}

export interface AdminUserListItem {
  id: string;
  email: string | null;
  supabaseId: string | null;
  createdAt: string;
  updatedAt: string;
  profile: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  roles: string[];
}

export interface AssignRoleDto {
  role: string;
}
