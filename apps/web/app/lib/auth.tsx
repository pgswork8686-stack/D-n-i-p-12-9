"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AuthMeResponse } from "@nexus/contracts";
import { apiFetch, ApiError } from "./api";
import { getSupabaseClient, isDevAuthEnabled } from "./supabase";

const DEV_TOKEN_KEY = "nexus_web_dev_token";

interface AuthState {
  user: AuthMeResponse | null;
  token: string | null;
  isLoading: boolean;
  isConfigured: boolean;
  loginWithPassword: (email: string, password: string) => Promise<string | null>;
  register: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  loginWithDevToken: (token: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function translateAuthError(message?: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login")) return "Email hoặc mật khẩu không đúng.";
  if (m.includes("email not confirmed")) return "Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.";
  if (m.includes("already registered")) return "Email này đã có tài khoản. Hãy đăng nhập.";
  if (m.includes("password")) return "Mật khẩu cần tối thiểu 8 ký tự.";
  return message || "Không thể xác thực. Vui lòng thử lại.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hydratedToken = useRef<string | null>(null);
  const supabase = typeof window !== "undefined" ? getSupabaseClient() : null;

  /** Exchanges an access token for the backend profile (the authority). */
  const hydrate = useCallback(async (accessToken: string): Promise<string | null> => {
    if (hydratedToken.current === accessToken) return null;
    try {
      const me = await apiFetch<AuthMeResponse>("/auth/me", { token: accessToken });
      hydratedToken.current = accessToken;
      setToken(accessToken);
      setUser(me);
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        hydratedToken.current = null;
        setToken(null);
        setUser(null);
        await getSupabaseClient()?.auth.signOut({ scope: "local" }).catch(() => {});
        return "Tài khoản chưa được xác thực với hệ thống.";
      }
      // Network/5xx: keep the session so the user is not logged out by an outage.
      setToken(accessToken);
      return err instanceof Error ? err.message : "Không kết nối được máy chủ.";
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();
    if (client) {
      client.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        const t = data.session?.access_token;
        (t ? hydrate(t) : Promise.resolve(null)).finally(() => mounted && setIsLoading(false));
      });
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Keep the callback synchronous; defer async work (Supabase deadlock guard).
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.access_token) {
          const t = session.access_token;
          setTimeout(() => mounted && void hydrate(t), 0);
        } else if (event === "SIGNED_OUT") {
          hydratedToken.current = null;
          setToken(null);
          setUser(null);
        }
      });
      return () => {
        mounted = false;
        data.subscription.unsubscribe();
      };
    }

    const stored = isDevAuthEnabled() ? localStorage.getItem(DEV_TOKEN_KEY) : null;
    (stored ? hydrate(stored) : Promise.resolve(null)).finally(() => mounted && setIsLoading(false));
    return () => {
      mounted = false;
    };
  }, [hydrate]);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const client = getSupabaseClient();
      if (!client) return "Đăng nhập chưa được cấu hình trên máy chủ.";
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return translateAuthError(error?.message);
      return hydrate(data.session.access_token);
    },
    [hydrate],
  );

  const register = useCallback(async (email: string, password: string) => {
    const client = getSupabaseClient();
    if (!client) return { error: "Đăng ký chưa được cấu hình trên máy chủ." };
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    if (error) return { error: translateAuthError(error.message) };
    if (!data.session) return { needsConfirmation: true };
    const hydrateError = await hydrate(data.session.access_token);
    return hydrateError ? { error: hydrateError } : {};
  }, [hydrate]);

  const loginWithDevToken = useCallback(
    async (devToken: string) => {
      if (!isDevAuthEnabled()) return "Dev login không khả dụng.";
      const err = await hydrate(devToken);
      if (!err) localStorage.setItem(DEV_TOKEN_KEY, devToken);
      return err;
    },
    [hydrate],
  );

  const logout = useCallback(async () => {
    hydratedToken.current = null;
    localStorage.removeItem(DEV_TOKEN_KEY);
    await getSupabaseClient()?.auth.signOut({ scope: "local" }).catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isConfigured: Boolean(supabase) || isDevAuthEnabled(),
        loginWithPassword,
        register,
        loginWithDevToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
