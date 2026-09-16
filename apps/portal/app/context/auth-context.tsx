"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
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

export interface FetchProfileResult {
  profile: AuthMeResponse | null;
  isAuthError: boolean;
}

export interface HydrationActions {
  setToken: (token: string | null) => void;
  setUser: (user: AuthMeResponse | null) => void;
  setIsConnectivityError: (isError: boolean) => void;
}

export interface HydrationOptions {
  apiClient?: { getAuthMe: () => Promise<AuthMeResponse> };
  supabaseClient?: { auth: { signOut: (opts?: { scope?: string }) => Promise<any> } } | null;
  isDevAuthEnabled?: boolean;
  storage?: { setItem: (k: string, v: string) => void; removeItem: (k: string) => void } | null;
  isMounted?: () => boolean;
}

/**
 * Authoritative session hydration helper.
 * - Sets token & user state when profile succeeds.
 * - On 401: Clears state and invokes signOut with explicit local scope ({ scope: "local" }).
 * - On 5xx/network error: Preserves session token, sets connectivity flag (setIsConnectivityError(true)), does NOT sign out.
 */
export async function handleAuthSessionHydration(
  authToken: string,
  actions: HydrationActions,
  options: HydrationOptions = {},
): Promise<boolean> {
  const isMounted = options.isMounted ?? (() => true);
  const client = options.apiClient ?? getApiClient(authToken);
  const supabase =
    options.supabaseClient !== undefined
      ? options.supabaseClient
      : getSupabaseClient();
  const devAuthEnabled =
    options.isDevAuthEnabled !== undefined
      ? options.isDevAuthEnabled
      : isDevAuthToolsEnabled();
  const storage =
    options.storage !== undefined
      ? options.storage
      : typeof window !== "undefined"
        ? localStorage
        : null;

  try {
    const profile = await client.getAuthMe();
    if (!isMounted()) return false;

    actions.setToken(authToken);
    actions.setUser(profile);
    actions.setIsConnectivityError(false);

    if (storage && !supabase && devAuthEnabled) {
      storage.setItem(TOKEN_KEY, authToken);
    }
    return true;
  } catch (err: any) {
    if (!isMounted()) return false;
    const status = err?.status || err?.statusCode;
    const msg = String(err?.message || "").toLowerCase();
    const isAuthError =
      status === 401 ||
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("invalid token");

    if (isAuthError) {
      // 401 / Invalid auth -> Purge session and token with explicit local signout scope
      if (storage) {
        storage.removeItem(TOKEN_KEY);
      }
      if (supabase) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      }
      if (!isMounted()) return false;
      actions.setToken(null);
      actions.setUser(null);
      actions.setIsConnectivityError(false);
      return false;
    } else {
      // Network error / 5xx / timeout -> PRESERVE session and token
      actions.setToken(authToken);
      actions.setIsConnectivityError(true);
      return false;
    }
  }
}

/**
 * Creates a deadlock-safe Supabase auth state listener.
 * - Callback is synchronous and returns immediately.
 * - Any async task (like hydration or signOut) is deferred via setTimeout(..., 0).
 */
export function createSupabaseAuthListener(
  supabase: {
    auth: {
      onAuthStateChange: (
        cb: (event: string, session: any) => void,
      ) => { data: { subscription: { unsubscribe: () => void } } };
    };
  },
  onSessionToken: (token: string) => void,
  onSignedOut: () => void,
  isMounted: () => boolean = () => true,
): { unsubscribe: () => void } {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (!isMounted()) return;
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      const accessToken = session?.access_token;
      if (accessToken) {
        setTimeout(() => {
          if (!isMounted()) return;
          onSessionToken(accessToken);
        }, 0);
      }
    } else if (event === "SIGNED_OUT") {
      onSignedOut();
    }
  });

  return subscription;
}

export function shouldSkipDuplicateHydration(
  activeHydratedToken: string | null,
  newAuthToken: string,
  user: any | null,
): boolean {
  return activeHydratedToken === newAuthToken && user !== null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnectivityError, setIsConnectivityError] = useState<boolean>(false);

  // Track the most recently hydrated token to prevent duplicate /auth/me requests
  // between synchronous sign-in resolution and async onAuthStateChange events.
  const activeHydratedTokenRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hydrateSession = useCallback(
    async (authToken: string): Promise<boolean> => {
      if (shouldSkipDuplicateHydration(activeHydratedTokenRef.current, authToken, user)) {
        return true;
      }

      const success = await handleAuthSessionHydration(
        authToken,
        {
          setToken,
          setUser,
          setIsConnectivityError,
        },
        {
          isMounted: () => isMountedRef.current,
        },
      );

      if (success) {
        activeHydratedTokenRef.current = authToken;
      } else {
        activeHydratedTokenRef.current = null;
      }
      return success;
    },
    [user],
  );

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    if (supabase) {
      // 1. Restore official Supabase session on mount
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

      // 2. Subscribe to auth state change events via deadlock-safe listener
      const subscription = createSupabaseAuthListener(
        supabase,
        (accessToken) => {
          void hydrateSession(accessToken);
        },
        () => {
          activeHydratedTokenRef.current = null;
          setToken(null);
          setUser(null);
          setIsConnectivityError(false);
          if (typeof window !== "undefined") {
            localStorage.removeItem(TOKEN_KEY);
          }
        },
        () => isMounted,
      );

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

  /**
   * Explicit local signout policy:
   * Terminate current browser session without affecting active sessions on other devices.
   */
  const logout = useCallback(async () => {
    activeHydratedTokenRef.current = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
    }
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    setIsConnectivityError(false);
  }, []);

  const refreshUser = useCallback(async () => {
    if (token) {
      activeHydratedTokenRef.current = null;
      await hydrateSession(token);
    }
  }, [token, hydrateSession]);

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
