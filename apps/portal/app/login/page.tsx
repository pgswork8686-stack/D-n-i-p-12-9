"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/auth-context";
import { Button, Card } from "@nexus/ui";

function isDevAuthToolsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true" ||
      process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true")
  );
}

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default function LoginPage() {
  const { loginWithPassword, loginWithDevToken, user } = useAuth();
  const router = useRouter();

  const isProductionUnconfigured =
    process.env.NODE_ENV === "production" && !isSupabaseConfigured();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    router.push("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProductionUnconfigured) {
      setError("Authentication service is temporarily unavailable. Please try again later.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Please enter both your email address and password.");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await loginWithPassword(email.trim(), password);
    if (result.success) {
      router.push("/");
    } else {
      setError(result.error || "Authentication failed. Please verify credentials.");
      setLoading(false);
    }
  };

  const handleDevLogin = async (devToken: string) => {
    if (!isDevAuthToolsEnabled()) return;
    setLoading(true);
    setError(null);
    const success = await loginWithDevToken(devToken);
    if (success) {
      router.push("/");
    } else {
      setError("Dev authentication token rejected.");
      setLoading(false);
    }
  };

  const showDevTools = isDevAuthToolsEnabled();

  return (
    <div className="min-h-screen bg-[#faf8ff] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[#0037b0] text-white flex items-center justify-center font-black text-2xl mx-auto mb-3 shadow-lg shadow-blue-500/20">
            N
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            NEXUSTHEME Customer Portal
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Sign in to access your licenses, downloads, and orders
          </p>
        </div>

        <Card title="Customer Sign In" subtitle="Enter your account credentials">
          {isProductionUnconfigured && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">
              ⚠️ Authentication service is currently unavailable. Please check back later or contact customer support.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
              >
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                required
                disabled={loading || isProductionUnconfigured}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0] focus:bg-white transition disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading || isProductionUnconfigured}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0] focus:bg-white transition disabled:opacity-60"
              />
            </div>

            {showDevTools && (
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 space-y-2">
                <span className="text-[11px] font-bold text-blue-900 block uppercase tracking-wider">
                  Development Presets (Local / Test Only):
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDevLogin("dev-customer-token")}
                    className="px-3 py-1 text-xs font-semibold rounded-lg border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 transition"
                  >
                    Customer 1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDevLogin("dev-admin-token")}
                    className="px-3 py-1 text-xs font-semibold rounded-lg border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 transition"
                  >
                    Admin
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full justify-center"
              disabled={loading || isProductionUnconfigured}
            >
              {loading ? "Authenticating..." : "Sign In to Portal →"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
