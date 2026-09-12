"use client";

import React, { useEffect, useState } from "react";
import { Badge, Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

export default function AdminHomePage() {
  const [apiHealth, setApiHealth] = useState<string>("Checking...");
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);

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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card
          title="Super Admin Architecture"
          subtitle="Central Operations Hub"
        >
          <ul className="text-sm text-gray-600 space-y-2">
            <li>✓ Catalog & License allocation controls</li>
            <li>✓ Upstream provider management (Elementor manual mode)</li>
            <li>✓ Audit logs & system diagnostics</li>
            <li>✓ Isolated admin portal subdomain</li>
          </ul>
        </Card>

        <Card
          title="Backend API Health"
          subtitle={`Live probe to ${API_URL}/health`}
        >
          <pre className="bg-gray-900 text-emerald-400 p-4 rounded-xl text-xs overflow-x-auto">
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
        <a href={PORTAL_URL} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            Go to Customer Portal →
          </Button>
        </a>
      </div>
    </main>
  );
}
