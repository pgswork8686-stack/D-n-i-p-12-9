"use client";

import React from "react";
import { useAuth } from "../context/auth-context";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { Button, Card, Badge } from "@nexus/ui";

export default function AccountPage() {
  const { user, logout } = useAuth();

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-3xl">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Customer Account
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Identity, role assignments, and portal session information.
            </p>
          </div>

          <Card title="Customer Identity" subtitle="Server-verified identity payload (/auth/me)">
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0037b0] to-cyan-500 text-white flex items-center justify-center font-black text-xl shadow-md">
                  {user?.profile?.displayName?.[0]?.toUpperCase() ||
                    user?.email?.[0]?.toUpperCase() ||
                    "U"}
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    {user?.profile?.displayName || "Verified Customer"}
                  </h3>
                  <p className="text-xs text-slate-500">{user?.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    User Identifier
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-800 break-all">
                    {user?.id}
                  </span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Assigned Roles
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {user?.roles?.map((r) => (
                      <Badge key={r} variant="success">
                        {r}
                      </Badge>
                    )) || <span className="text-xs text-slate-500">None</span>}
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Granted RBAC Permissions ({user?.permissions?.length || 0})
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-white rounded-lg border border-slate-200">
                  {user?.permissions?.map((p) => (
                    <span
                      key={p}
                      className="px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-[#0037b0] rounded-md font-mono"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <span className="text-xs text-slate-400">
                  Active session managed securely by token transport
                </span>
                <Button variant="outline" size="sm" onClick={logout} className="text-red-600 border-red-200 hover:bg-red-50">
                  Sign Out of Account
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
