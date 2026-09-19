"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@nexus/ui";
import { useAuth, isDevAuthToolsEnabled } from "./context/auth-context";
import { getApiUrl } from "./lib/api";

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

export default function AdminHomePage() {
  const { token, user, logout, loginWithDevToken, isLoading: authLoading } = useAuth();
  const [apiHealth, setApiHealth] = useState<string>("Checking...");
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [adminAccess, setAdminAccess] = useState<{
    allowed: boolean;
    statusText: string;
    roles?: any[];
  }>({
    allowed: false,
    statusText: "Checking authorization...",
  });

  useEffect(() => {
    let apiUrl: string;
    try {
      apiUrl = getApiUrl();
    } catch {
      setIsHealthy(false);
      setApiHealth(
        "Admin API configuration unavailable: Production requires a valid HTTPS API URL.",
      );
      return;
    }

    fetch(`${apiUrl}/health`)
      .then((res) => res.json())
      .then((data) => {
        setIsHealthy(data.status === "ok");
        setApiHealth(JSON.stringify(data, null, 2));
      })
      .catch((err) => {
        setIsHealthy(false);
        setApiHealth(`Failed to connect: ${err.message}`);
      });
  }, []);

  useEffect(() => {
    if (!token) {
      setAdminAccess({
        allowed: false,
        statusText: "Access Denied (401 Unauthorized): Please sign in with an authenticated admin account.",
      });
      return;
    }

    let apiUrl: string;
    try {
      apiUrl = getApiUrl();
    } catch {
      setAdminAccess({
        allowed: false,
        statusText: "Admin API configuration unavailable",
      });
      return;
    }

    fetch(`${apiUrl}/admin/roles`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            `Access Denied (${res.status} ${res.statusText}): ${body.message || "Insufficient permissions for Admin operations"}`,
          );
        }
        return res.json();
      })
      .then((data) => {
        setAdminAccess({
          allowed: true,
          statusText: "Access Granted: Verified server-side admin authority.",
          roles: data.roles || [],
        });
      })
      .catch((err) => {
        setAdminAccess({
          allowed: false,
          statusText: err.message,
        });
      });
  }, [token]);

  const showDevTools = isDevAuthToolsEnabled();

  return (
    <main className="max-w-4xl mx-auto py-12 px-6">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0037b0]">
            NEXUSTHEME Super Admin
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Central Operations & Control Center (apps/admin — Port 3002)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={
              isHealthy ? "success" : isHealthy === false ? "error" : "warning"
            }
          >
            {isHealthy
              ? "API Connected"
              : isHealthy === false
                ? "API Disconnected"
                : "Checking API..."}
          </Badge>
          <Badge variant={adminAccess.allowed ? "success" : "error"}>
            {adminAccess.allowed ? "Admin Verified" : "Access Denied"}
          </Badge>
          {token ? (
            <Button variant="outline" size="sm" onClick={() => logout()}>
              Sign Out
            </Button>
          ) : (
            <Link href="/login">
              <Button variant="primary" size="sm">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </div>

      {showDevTools && (
        <div className="mb-6 bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-gray-800">
              Simulate Client Identity Token (Dev Only):
            </span>
            <p className="text-xs text-gray-500">
              Test how Admin UI reacts to different user authorization levels
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => loginWithDevToken("dev-admin-token")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                token === "dev-admin-token"
                  ? "bg-[#0037b0] text-white border-[#0037b0]"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              Admin Token (Pass)
            </button>
            <button
              onClick={() => loginWithDevToken("dev-customer-token")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                token === "dev-customer-token"
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              Customer Token (403)
            </button>
            <button
              onClick={() => logout()}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                !token
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              No Token (401)
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card
          title="RBAC Authorization Guard"
          subtitle="Real-time check against /admin/roles"
        >
          {adminAccess.allowed ? (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold">
                ✓ {adminAccess.statusText}
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Configured Platform Roles ({adminAccess.roles?.length || 0}):
                </h4>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {adminAccess.roles?.map((r) => (
                    <div
                      key={r.id}
                      className="p-2 bg-gray-50 rounded border border-gray-200 flex justify-between items-center text-xs"
                    >
                      <span className="font-semibold text-gray-900">{r.name}</span>
                      <span className="text-gray-500">
                        {r.permissions?.length} perms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-center space-y-3">
              <div className="text-3xl">🚫</div>
              <h3 className="text-base font-bold text-red-800">
                Access Denied / Unauthorized
              </h3>
              <p className="text-xs text-red-600">{adminAccess.statusText}</p>
              <p className="text-[11px] text-gray-500">
                Client-side UI respects server authority. Access cannot be bypassed by client tampering.
              </p>
              {!token && (
                <div className="pt-2">
                  <Link href="/login">
                    <Button variant="primary" size="sm">
                      Go to Sign In
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Backend API Health"
          subtitle={(() => {
            try {
              return `Live probe to ${getApiUrl()}/health`;
            } catch {
              return "Live probe to /health (configuration unavailable)";
            }
          })()}
        >
          <pre className="bg-gray-900 text-emerald-400 p-4 rounded-xl text-xs overflow-x-auto h-52">
            {apiHealth}
          </pre>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <a href="/admin/products">
          <Button variant="primary" size="sm">
            📦 Manage Catalog & Products →
          </Button>
        </a>
        <a href="/content">
          <Button variant="primary" size="sm">
            ✍️ Manage Content (CMS) →
          </Button>
        </a>
        <a href="/automation">
          <Button variant="primary" size="sm">
            ⚡ Automation & AI Engine →
          </Button>
        </a>
        <a href={WEB_URL} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm">
            ← Return to Marketplace
          </Button>
        </a>
        <a href={PORTAL_URL} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            Go to Customer Portal →
          </Button>
        </a>
      </div>
    </main>
  );
}
