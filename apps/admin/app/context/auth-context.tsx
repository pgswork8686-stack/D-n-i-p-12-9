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

const TOKEN_KEY = "nexus_admin_token";

export function isDevAuthToolsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true" ||
      process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true")
  );
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

export type HydrationResult =
  | { status: "authenticated" }
  | { status: "unauthorized"; error?: string }
  | { status: "unavailable"; error?: string };

/**
 * Authoritative session hydration helper for Admin Operations.
 * - Sets token & user state when profile succeeds -> { status: "authenticated" }.
 * - On 401: Clears state and invokes signOut with explicit local scope ({ scope: "local" }) -> { status: "unauthorized" }.
 * - On 5xx/network error: Preserves session token, sets connectivity flag (setIsConnectivityError(true)), does NOT sign out -> { status: "unavailable" }.
 */
export async function handleAuthSessionHydration(
  authToken: string,
  actions: HydrationActions,
  options: HydrationOptions = {},
): Promise<HydrationResult> {
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
    if (!isMounted()) return { status: "unavailable", error: "Component unmounted" };

    actions.setToken(authToken);
    actions.setUser(profile);
    actions.setIsConnectivityError(false);

    if (storage && !supabase && devAuthEnabled) {
      storage.setItem(TOKEN_KEY, authToken);
    }
    return { status: "authenticated" };
  } catch (err: any) {
    if (!isMounted()) return { status: "unavailable", error: "Component unmounted" };
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
      if (!isMounted()) return { status: "unauthorized", error: "Unauthorized" };
      actions.setToken(null);
      actions.setUser(null);
      actions.setIsConnectivityError(false);
      return {
        status: "unauthorized",
        error: "Your account could not be authorized for Admin operations.",
      };
    } else {
      // Network error / 5xx / timeout -> PRESERVE session and token
      actions.setToken(authToken);
      actions.setIsConnectivityError(true);
      return {
        status: "unavailable",
        error:
          "Authentication succeeded, but Admin API is temporarily unavailable. Please try again.",
      };
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
  inFlightToken?: string | null,
): boolean {
  return (
    activeHydratedToken === newAuthToken ||
    (Boolean(inFlightToken) && inFlightToken === newAuthToken)
  );
}

export async function performPasswordLogin(
  supabase: {
    auth: {
      signInWithPassword: (creds: {
        email: string;
        password: string;
      }) => Promise<{
        data: { session: { access_token: string } | null };
        error: any;
      }>;
    };
  } | null,
  credentials: { email: string; password: string },
  hydrate: (token: string) => Promise<HydrationResult>,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return {
      success: false,
      error: "Supabase client is not configured for authentication.",
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword(credentials);

    if (error || !data.session?.access_token) {
      return {
        success: false,
        error: error?.message || "Invalid email or password.",
      };
    }

    const hydrationResult = await hydrate(data.session.access_token);

    if (hydrationResult.status === "authenticated") {
      return { success: true };
    }

    if (hydrationResult.status === "unauthorized") {
      return {
        success: false,
        error: "Your account could not be authorized for Admin operations.",
      };
    }

    return {
      success: false,
      error:
        "Authentication succeeded, but Admin API is temporarily unavailable. Please try again.",
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Authentication failed. Please try again.",
    };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnectivityError, setIsConnectivityError] = useState<boolean>(false);

  const activeHydratedTokenRef = useRef<string | null>(null);
  const inFlightHydrationTokenRef = useRef<string | null>(null);
  const inFlightHydrationPromiseRef = useRef<{
    token: string;
    promise: Promise<HydrationResult>;
  } | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hydrateSession = useCallback(
    async (authToken: string): Promise<HydrationResult> => {
      if (activeHydratedTokenRef.current === authToken) {
        return { status: "authenticated" };
      }

      if (
        inFlightHydrationPromiseRef.current &&
        inFlightHydrationPromiseRef.current.token === authToken
      ) {
        return await inFlightHydrationPromiseRef.current.promise;
      }

      inFlightHydrationTokenRef.current = authToken;

      const promise = (async (): Promise<HydrationResult> => {
        try {
          const result = await handleAuthSessionHydration(
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

          if (result.status === "authenticated") {
            activeHydratedTokenRef.current = authToken;
          } else {
            activeHydratedTokenRef.current = null;
          }
          return result;
        } finally {
          if (inFlightHydrationTokenRef.current === authToken) {
            inFlightHydrationTokenRef.current = null;
          }
          if (inFlightHydrationPromiseRef.current?.token === authToken) {
            inFlightHydrationPromiseRef.current = null;
          }
        }
      })();

      inFlightHydrationPromiseRef.current = {
        token: authToken,
        promise,
      };

      return await promise;
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    if (supabase) {
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          if (!isMounted) return;
          if (session?.access_token) {
            hydrateSession(session.access_token).finally(() => {
              if (isMounted) setIsLoading(false);
            });
          } else {
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

      const subscription = createSupabaseAuthListener(
        supabase,
        (accessToken) => {
          void hydrateSession(accessToken);
        },
        () => {
          activeHydratedTokenRef.current = null;
          inFlightHydrationTokenRef.current = null;
          inFlightHydrationPromiseRef.current = null;
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
      try {
        const supabase = getSupabaseClient();
        return await performPasswordLogin(
          supabase,
          { email, password },
          hydrateSession,
        );
      } finally {
        setIsLoading(false);
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
      const result = await hydrateSession(devToken);
      setIsLoading(false);
      return result.status === "authenticated";
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
    activeHydratedTokenRef.current = null;
    inFlightHydrationTokenRef.current = null;
    inFlightHydrationPromiseRef.current = null;
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
