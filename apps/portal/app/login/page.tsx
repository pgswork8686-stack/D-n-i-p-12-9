"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/auth-context";
import { Button, Card } from "@nexus/ui";

const isDevAuthToolsEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS === "true";

export default function LoginPage() {
  const { login, user } = useAuth();
  const router = useRouter();
  const [tokenInput, setTokenInput] = useState(
    isDevAuthToolsEnabled ? "dev-customer-token" : "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    router.push("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setError("Please enter an authentication token");
      return;
    }

    setLoading(true);
    setError(null);

    const success = await login(tokenInput.trim());
    if (success) {
      router.push("/");
    } else {
      setError("Invalid or expired session token. Please verify credentials.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf8ff] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[#0037b0] text-white flex items-center justify-center font-black text-2xl mx-auto mb-3 shadow-lg shadow-blue-500/20">
            N
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            NEXUSTHEME Portal
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Sign in to access your licenses, downloads, and orders
          </p>
        </div>

        <Card title="Account Access" subtitle="Client authentication session">
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div>
              <label
                htmlFor="authToken"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2"
              >
                Session Bearer Token
              </label>
              <input
                id="authToken"
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Enter customer session token"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0037b0] focus:bg-white transition"
              />
            </div>

            {isDevAuthToolsEnabled && (
              <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 space-y-2">
                <span className="text-[11px] font-bold text-blue-900 block uppercase tracking-wider">
                  Development Presets:
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTokenInput("dev-customer-token")}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg border transition ${
                      tokenInput === "dev-customer-token"
                        ? "bg-[#0037b0] text-white border-[#0037b0]"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Customer 1
                  </button>
                  <button
                    type="button"
                    onClick={() => setTokenInput("dev-admin-token")}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg border transition ${
                      tokenInput === "dev-admin-token"
                        ? "bg-[#0037b0] text-white border-[#0037b0]"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
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
              disabled={loading}
            >
              {loading ? "Authenticating..." : "Sign In to Portal →"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
