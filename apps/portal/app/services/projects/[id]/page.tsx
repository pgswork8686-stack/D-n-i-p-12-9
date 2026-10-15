"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@nexus/ui";
import { SERVICE_FILE_MAX_BYTES, ServiceProjectDto } from "@nexus/contracts";
import { useAuth } from "../../../context/auth-context";
import { getApiClient } from "../../../lib/api";
import { AuthGuard } from "../../../components/auth-guard";
import { PortalShell } from "../../../components/portal-shell";
import { Skeleton } from "../../../components/skeleton";
import { ErrorState } from "../../../components/error-state";
import { MilestoneStatusBadge, ProjectStatusBadge } from "../../badges";
import { EVENT_LABELS, PROJECT_STATUS_LABELS, formatBytes, formatDate } from "../../labels";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<ServiceProjectDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      setProject(await getApiClient(token).getMyServiceProject(id));
    } catch (err: any) {
      setError(err?.message || "Project not found");
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  const closed = project?.status === "COMPLETED" || project?.status === "CANCELLED";

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !project || !message.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      setProject(await getApiClient(token).postMyProjectMessage(project.id, { body: message.trim() }));
      setMessage("");
    } catch (err: any) {
      setActionError(err?.message || "Failed to send message");
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async (file: File | undefined) => {
    if (!token || !project || !file) return;
    setActionError(null);
    if (file.size > SERVICE_FILE_MAX_BYTES) {
      setActionError(`File exceeds ${SERVICE_FILE_MAX_BYTES / (1024 * 1024)} MB`);
      return;
    }
    setBusy(true);
    try {
      setProject(await getApiClient(token).uploadMyProjectDocument(project.id, file));
    } catch (err: any) {
      setActionError(err?.message || "Failed to upload document");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const openDocument = async (documentId: string) => {
    if (!token || !project) return;
    try {
      const { url } = await getApiClient(token).getMyProjectDocumentUrl(project.id, documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setActionError(err?.message || "Failed to open document");
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-6xl mx-auto space-y-6">
          <Link href="/services" className="text-sm text-slate-500 hover:text-[#0037b0]">
            ← Service Projects
          </Link>

          {loading ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : error || !project ? (
            <ErrorState title="Project unavailable" message={error || "Project not found"} onRetry={load} />
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {project.projectCode}
                      </span>
                      <span className="text-xs text-slate-400">{project.service.name}</span>
                      {project.inquiryNumber && <span className="text-xs text-slate-400">• Request {project.inquiryNumber}</span>}
                    </div>
                    <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{project.title}</h1>
                    {project.summary && <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">{project.summary}</p>}
                  </div>
                  <ProjectStatusBadge status={project.status} />
                </div>
                <dl className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Start</dt>
                    <dd className="font-medium text-slate-800">{formatDate(project.startDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Target</dt>
                    <dd className="font-medium text-slate-800">{formatDate(project.targetDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Milestones</dt>
                    <dd className="font-medium text-slate-800">
                      {project.milestoneProgress.done}/{project.milestoneProgress.total} done
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Team</dt>
                    <dd className="font-medium text-slate-800">
                      {project.members.length ? project.members.map((m) => m.displayName || "PGS team").join(", ") : "Being assigned"}
                    </dd>
                  </div>
                </dl>
              </div>

              {actionError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
                  {actionError}
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <div className="space-y-6 min-w-0">
                  <section aria-labelledby="ms-heading" className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h2 id="ms-heading" className="text-lg font-bold text-slate-900">
                      Milestones
                    </h2>
                    {project.milestones.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Milestones will appear once the plan is confirmed.</p>
                    ) : (
                      <ol className="mt-4 space-y-3">
                        {project.milestones.map((m, i) => (
                          <li key={m.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100">
                            <span
                              className={`mt-0.5 w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                                m.status === "DONE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {m.status === "DONE" ? "✓" : i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="font-semibold text-slate-900">{m.title}</h3>
                                <MilestoneStatusBadge status={m.status} />
                              </div>
                              {m.description && <p className="mt-1 text-sm text-slate-600">{m.description}</p>}
                              <p className="mt-1 text-xs text-slate-400">
                                Due {formatDate(m.dueDate)}
                                {m.completedAt ? ` • Completed ${formatDate(m.completedAt)}` : ""}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  <section aria-labelledby="msg-heading" className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h2 id="msg-heading" className="text-lg font-bold text-slate-900">
                      Messages
                    </h2>
                    <div className="mt-4 space-y-3">
                      {project.messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
                      {project.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`p-3 rounded-xl text-sm ${m.senderType === "CUSTOMER" ? "bg-blue-50 ml-8" : "bg-slate-50 mr-8"}`}
                        >
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span className="font-semibold">{m.senderType === "CUSTOMER" ? "You" : m.senderName || "PGS team"}</span>
                            <span>{new Date(m.createdAt).toLocaleString("vi-VN")}</span>
                          </div>
                          <p className="whitespace-pre-line text-slate-800">{m.body}</p>
                        </div>
                      ))}
                    </div>
                    {closed ? (
                      <p className="mt-4 text-sm text-slate-500">
                        This project is {PROJECT_STATUS_LABELS[project.status].toLowerCase()}. Open a support ticket for further help.
                      </p>
                    ) : (
                      <form onSubmit={sendMessage} className="mt-4 space-y-2">
                        <label htmlFor="project-message" className="sr-only">
                          Message
                        </label>
                        <textarea
                          id="project-message"
                          rows={3}
                          maxLength={5000}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder="Write a message to the project team…"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex justify-end">
                          <Button type="submit" variant="primary" disabled={busy || !message.trim()}>
                            {busy ? "Sending…" : "Send"}
                          </Button>
                        </div>
                      </form>
                    )}
                  </section>
                </div>

                <div className="space-y-6">
                  <section aria-labelledby="doc-heading" className="bg-white border border-slate-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                      <h2 id="doc-heading" className="text-lg font-bold text-slate-900">
                        Documents
                      </h2>
                      {!closed && (
                        <>
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                            Upload
                          </Button>
                          <input
                            ref={fileInput}
                            type="file"
                            accept={ACCEPT}
                            className="sr-only"
                            onChange={(e) => uploadDocument(e.target.files?.[0])}
                          />
                        </>
                      )}
                    </div>
                    {project.documents.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">No documents shared yet.</p>
                    ) : (
                      <ul className="mt-4 space-y-2">
                        {project.documents.map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => openDocument(d.id)}
                              className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-blue-300 transition"
                            >
                              <span className="block text-sm font-medium text-slate-800 truncate">{d.fileName}</span>
                              <span className="block text-xs text-slate-400">
                                {formatBytes(d.sizeBytes)} • {d.uploaderType === "CUSTOMER" ? "You" : "PGS team"} • {formatDate(d.createdAt)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section aria-labelledby="hist-heading" className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h2 id="hist-heading" className="text-lg font-bold text-slate-900">
                      History
                    </h2>
                    <ul className="mt-4 space-y-3">
                      {project.events.map((e) => (
                        <li key={e.id} className="text-sm">
                          <span className="font-medium text-slate-800">{EVENT_LABELS[e.type]}</span>
                          {e.type === "STATUS_CHANGED" && e.toStatus && (
                            <span className="text-slate-500">
                              {" "}
                              → {PROJECT_STATUS_LABELS[e.toStatus as keyof typeof PROJECT_STATUS_LABELS] || e.toStatus}
                            </span>
                          )}
                          <span className="block text-xs text-slate-400">{new Date(e.createdAt).toLocaleString("vi-VN")}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
