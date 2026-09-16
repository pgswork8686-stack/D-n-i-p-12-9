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

interface AuthContextType {
  user: AuthMeResponse | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "nexus_portal_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchUser = useCallback(async (authToken: string): Promise<AuthMeResponse | null> => {
    try {
      const client = getApiClient(authToken);
      const profile = await client.getAuthMe();
      return profile;
    } catch (err) {
      return null;
    }
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (stored) {
      setToken(stored);
      fetchUser(stored).then((userData) => {
        if (userData) {
          setUser(userData);
        } else {
          // Token invalid or expired
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [fetchUser]);

  const login = useCallback(
    async (newToken: string): Promise<boolean> => {
      setIsLoading(true);
      const userData = await fetchUser(newToken);
      if (userData) {
        if (typeof window !== "undefined") {
          localStorage.setItem(TOKEN_KEY, newToken);
        }
        setToken(newToken);
        setUser(userData);
        setIsLoading(false);
        return true;
      }
      setIsLoading(false);
      return false;
    },
    [fetchUser],
  );

  const logout = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
    }
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (token) {
      const userData = await fetchUser(token);
      if (userData) {
        setUser(userData);
      } else {
        logout();
      }
    }
  }, [token, fetchUser, logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
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
