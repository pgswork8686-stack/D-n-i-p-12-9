"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { AuthMeResponse } from "@nexus/contracts";
import { getApiClient } from "../lib/api";
import { getSupabaseClient } from "../lib/supabase";

export interface AuthContextType {
  user: AuthMeResponse | null;
  token: string | null;
  isLoading: boolean;
  isConnectivityError: boolean;
  loginWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  loginWithDevToken: (token: string) => Promise<boolean>;
  login: (emailOrToken: string, password?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "nexus_portal_token";

export function isDevAuthToolsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true" ||
      process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true")
  );
}

interface FetchProfileResult {
  profile: AuthMeResponse | null;
  isAuthError: boolean;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnectivityError, setIsConnectivityError] = useState<boolean>(false);

  const fetchUserProfile = useCallback(
    async (authToken: string): Promise<FetchProfileResult> => {
      try {
        const client = getApiClient(authToken);
        const profile = await client.getAuthMe();
        return { profile, isAuthError: false };
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        const msg = String(err?.message || "").toLowerCase();
        const isAuthError =
          status === 401 ||
          msg.includes("401") ||
          msg.includes("unauthorized") ||
          msg.includes("invalid token");
        return { profile: null, isAuthError: Boolean(isAuthError) };
      }
    },
    [],
  );

  const hydrateSession = useCallback(
    async (authToken: string): Promise<boolean> => {
      const { profile, isAuthError } = await fetchUserProfile(authToken);
      if (profile) {
        setToken(authToken);
        setUser(profile);
        setIsConnectivityError(false);
        if (
          typeof window !== "undefined" &&
          !getSupabaseClient() &&
          isDevAuthToolsEnabled()
        ) {
          localStorage.setItem(TOKEN_KEY, authToken);
        }
        return true;
      } else if (isAuthError) {
        // 401 / Invalid auth -> Purge session and token
        if (typeof window !== "undefined") {
          localStorage.removeItem(TOKEN_KEY);
        }
        const supabase = getSupabaseClient();
        if (supabase) {
          await supabase.auth.signOut().catch(() => {});
        }
        setToken(null);
        setUser(null);
        setIsConnectivityError(false);
        return false;
      } else {
        // Network error / 5xx / timeout -> PRESERVE session and token
        setToken(authToken);
        setIsConnectivityError(true);
        return false;
      }
    },
    [fetchUserProfile],
  );

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    if (supabase) {
      // 1. Restore official Supabase session
      supabase.auth
        .getSession()
        .then(({ data: { session }, error }) => {
          if (!isMounted) return;
          if (session?.access_token) {
            hydrateSession(session.access_token).finally(() => {
              if (isMounted) setIsLoading(false);
            });
          } else {
            // Check dev fallback if explicitly enabled
            const stored =
              typeof window !== "undefined" && isDevAuthToolsEnabled()
                ? localStorage.getItem(TOKEN_KEY)
                : null;
            if (stored) {
              hydrateSession(stored).finally(() => {
                if (isMounted) setIsLoading(false);
              });
            } else {
              setIsLoading(false);
            }
          }
        })
        .catch(() => {
          if (isMounted) setIsLoading(false);
        });

      // 2. Subscribe to auth state change events
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          if (session?.access_token) {
            await hydrateSession(session.access_token);
          }
        } else if (event === "SIGNED_OUT") {
          setToken(null);
          setUser(null);
          setIsConnectivityError(false);
          if (typeof window !== "undefined") {
            localStorage.removeItem(TOKEN_KEY);
          }
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    } else {
      // Local dev / test mock fallback when Supabase is unconfigured
      const stored =
        typeof window !== "undefined" && isDevAuthToolsEnabled()
          ? localStorage.getItem(TOKEN_KEY)
          : null;
      if (stored) {
        hydrateSession(stored).finally(() => {
          if (isMounted) setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
      return () => {
        isMounted = false;
      };
    }
  }, [hydrateSession]);

  const loginWithPassword = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ success: boolean; error?: string }> => {
      setIsLoading(true);
      const supabase = getSupabaseClient();
      if (!supabase) {
        setIsLoading(false);
        return {
          success: false,
          error: "Supabase client is not configured for authentication.",
        };
      }

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error || !data.session?.access_token) {
          setIsLoading(false);
          return {
            success: false,
            error: error?.message || "Invalid email or password.",
          };
        }

        await hydrateSession(data.session.access_token);
        setIsLoading(false);
        return { success: true };
      } catch (err: any) {
        setIsLoading(false);
        return {
          success: false,
          error: err?.message || "Authentication failed. Please try again.",
        };
      }
    },
    [hydrateSession],
  );

  const loginWithDevToken = useCallback(
    async (devToken: string): Promise<boolean> => {
      if (!isDevAuthToolsEnabled()) {
        return false;
      }
      setIsLoading(true);
      const success = await hydrateSession(devToken);
      setIsLoading(false);
      return success;
    },
    [hydrateSession],
  );

  const login = useCallback(
    async (emailOrToken: string, password?: string): Promise<boolean> => {
      if (password !== undefined) {
        const result = await loginWithPassword(emailOrToken, password);
        return result.success;
      }
      return loginWithDevToken(emailOrToken);
    },
    [loginWithPassword, loginWithDevToken],
  );

  const logout = useCallback(async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
    }
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    setToken(null);
    setUser(null);
    setIsConnectivityError(false);
  }, []);

  const refreshUser = useCallback(async () => {
    if (token) {
      const { profile, isAuthError } = await fetchUserProfile(token);
      if (profile) {
        setUser(profile);
        setIsConnectivityError(false);
      } else if (isAuthError) {
        await logout();
      } else {
        // Network error / 5xx: preserve user & token, set connectivity flag
        setIsConnectivityError(true);
      }
    }
  }, [token, fetchUserProfile, logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isConnectivityError,
        loginWithPassword,
        loginWithDevToken,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
