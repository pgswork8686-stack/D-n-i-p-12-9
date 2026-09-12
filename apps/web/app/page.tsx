"use client";

import React, { useEffect, useState } from "react";
import { Badge, Button, Card } from "@nexus/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";
const ADMIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3002";

export default function WebHomePage() {
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
            NEXUSTHEME Marketplace
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Public Web & SEO Engine (apps/web — Port 3000)
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
        <Card title="Phase 1 Foundation" subtitle="Monorepo & Infrastructure">
          <ul className="text-sm text-gray-600 space-y-2">
            <li>✓ Turborepo + pnpm workspace</li>
            <li>✓ TypeScript Strict Mode</li>
            <li>✓ Tailwind CSS + Shared UI tokens</li>
            <li>✓ Modular architecture ready for Phase 2</li>
          </ul>
        </Card>

        <Card
          title="Backend Connectivity"
          subtitle={`Live probe to ${API_URL}/health`}
        >
          <pre className="bg-gray-900 text-emerald-400 p-4 rounded-xl text-xs overflow-x-auto">
            {apiHealth}
          </pre>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <a href={PORTAL_URL} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm">
            Go to Customer Portal →
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
