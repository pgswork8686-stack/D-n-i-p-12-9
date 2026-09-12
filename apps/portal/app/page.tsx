"use client";

import React, { useEffect, useState } from "react";
import { Badge, Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const ADMIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3002";

export default function PortalHomePage() {
  const [apiHealth, setApiHealth] = useState<string>("Checking...");
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [authToken, setAuthToken] = useState<string>("dev-customer-token");
  const [userData, setUserData] = useState<any>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
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
    if (!authToken) {
      setUserData(null);
      setAuthError("No authorization token provided (Anonymous)");
      return;
    }

    fetch(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        return res.json();
      })
      .then((data) => {
        setUserData(data);
        setAuthError(null);
      })
      .catch((err) => {
        setUserData(null);
        setAuthError(err.message);
      });
  }, [authToken]);

  return (
    <main className="max-w-4xl mx-auto py-12 px-6">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0037b0]">
            NEXUSTHEME Customer Portal
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Client License & Download Hub (apps/portal — Port 3001)
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Badge variant={userData ? "success" : "warning"}>
            {userData ? `User: ${userData.email}` : "Guest Mode"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card
          title="Customer Identity & RBAC"
          subtitle="Server-verified authentication state (/auth/me)"
        >
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setAuthToken("dev-customer-token")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                  authToken === "dev-customer-token"
                    ? "bg-[#0037b0] text-white border-[#0037b0]"
                    : "bg-white text-gray-700 border-gray-300"
                }`}
              >
                Customer Token
              </button>
              <button
                onClick={() => setAuthToken("dev-admin-token")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                  authToken === "dev-admin-token"
                    ? "bg-[#0037b0] text-white border-[#0037b0]"
                    : "bg-white text-gray-700 border-gray-300"
                }`}
              >
                Admin Token
              </button>
              <button
                onClick={() => setAuthToken("")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                  !authToken
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-gray-700 border-gray-300"
                }`}
              >
                No Token
              </button>
            </div>

            {userData ? (
              <div className="bg-gray-50 p-4 rounded-xl space-y-2 text-sm border border-gray-200">
                <div className="flex justify-between">
                  <span className="font-semibold text-gray-600">Email:</span>
                  <span className="text-gray-900 font-medium">{userData.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold text-gray-600">Display Name:</span>
                  <span className="text-gray-900 font-medium">
                    {userData.profile?.displayName || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-600">Roles:</span>
                  <div className="flex gap-1">
                    {userData.roles?.map((r: string) => (
                      <span
                        key={r}
                        className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-semibold"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-gray-600 block mb-1">
                    Permissions ({userData.permissions?.length || 0}):
                  </span>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-white rounded border border-gray-200">
                    {userData.permissions?.map((p: string) => (
                      <span
                        key={p}
                        className="bg-emerald-50 text-emerald-700 text-[11px] px-1.5 py-0.5 rounded"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                {authError || "Waiting for authentication response..."}
              </div>
            )}
          </div>
        </Card>

        <Card
          title="Backend API Health"
          subtitle={`Live probe to ${API_URL}/health`}
        >
          <pre className="bg-gray-900 text-emerald-400 p-4 rounded-xl text-xs overflow-x-auto h-52">
            {apiHealth}
          </pre>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <a href={WEB_URL} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm">
            ← Return to Marketplace
          </Button>
        </a>
        <a href={ADMIN_URL} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            Go to Admin Dashboard →
          </Button>
        </a>
      </div>
    </main>
  );
}
