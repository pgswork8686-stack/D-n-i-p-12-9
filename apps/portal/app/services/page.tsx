"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@nexus/ui";
import { ServiceInquiryDto, ServiceProjectSummaryDto } from "@nexus/contracts";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { ProjectStatusBadge } from "./badges";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { INQUIRY_STATUS_LABELS, formatDate } from "./labels";

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

export default function MyServicesPage() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<ServiceProjectSummaryDto[]>([]);
  const [inquiries, setInquiries] = useState<ServiceInquiryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const [p, i] = await Promise.all([
        client.listMyServiceProjects({ limit: 50 }),
        client.listMyServiceInquiries({ limit: 50 }),
      ]);
      setProjects(p.items);
      setInquiries(i.items);
    } catch (err: any) {
      setError(err?.message || "Failed to load your projects");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const openInquiries = inquiries.filter((i) => i.status !== "CONVERTED");

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Service Projects</h1>
              <p className="text-sm text-slate-500 mt-1">
                Track your custom development, chatbot and automation projects.
              </p>
            </div>
            <a
              href={`${WEB_URL}/services`}
              className="inline-flex items-center justify-center rounded-xl bg-[#0037b0] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 transition"
            >
              + New project request
            </a>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : error ? (
            <ErrorState title="Error loading projects" message={error} onRetry={load} />
          ) : (
            <>
              <section aria-labelledby="projects-heading" className="space-y-3">
                <h2 id="projects-heading" className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  Projects
                </h2>
                {projects.length === 0 ? (
                  <EmptyState
                    icon="🧩"
                    title="No projects yet"
                    description="Once we confirm your request, the project, its milestones and documents appear here."
                  />
                ) : (
                  <div className="grid gap-3">
                    {projects.map((p) => {
                      const pct = p.milestoneProgress.total
                        ? Math.round((p.milestoneProgress.done / p.milestoneProgress.total) * 100)
                        : 0;
                      return (
                        <Link
                          key={p.id}
                          href={`/services/projects/${p.id}`}
                          className="block p-5 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:shadow-sm transition group"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                  {p.projectCode}
                                </span>
                                <span className="text-xs font-medium text-slate-400">{p.service.name}</span>
                              </div>
                              <h3 className="text-base font-semibold text-slate-900 group-hover:text-[#0037b0] transition truncate">
                                {p.title}
                              </h3>
                              <p className="text-xs text-slate-400">
                                Target {formatDate(p.targetDate)} • Updated {formatDate(p.updatedAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                              <div className="w-32">
                                <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                                  <span>Milestones</span>
                                  <span>
                                    {p.milestoneProgress.done}/{p.milestoneProgress.total}
                                  </span>
                                </div>
                                <div
                                  className="h-1.5 rounded-full bg-slate-100 overflow-hidden"
                                  role="progressbar"
                                  aria-valuenow={pct}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-label="Milestone progress"
                                >
                                  <div className="h-full bg-[#0037b0]" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              <ProjectStatusBadge status={p.status} />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>

              <section aria-labelledby="inquiries-heading" className="space-y-3">
                <h2 id="inquiries-heading" className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  Requests in review
                </h2>
                {openInquiries.length === 0 ? (
                  <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-5">
                    No open requests.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {openInquiries.map((i) => (
                      <Link
                        key={i.id}
                        href={`/services/inquiries/${i.id}`}
                        className="block p-5 bg-white border border-slate-200 rounded-xl hover:border-blue-400 transition"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                {i.inquiryNumber}
                              </span>
                              <span className="text-xs text-slate-400">{i.service.name}</span>
                            </div>
                            <p className="text-sm text-slate-700 line-clamp-1">{i.requirements}</p>
                            <p className="text-xs text-slate-400">Submitted {formatDate(i.createdAt)}</p>
                          </div>
                          <Badge variant={i.status === "REJECTED" ? "error" : i.status === "QUALIFIED" ? "success" : "warning"}>
                            {INQUIRY_STATUS_LABELS[i.status]}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
