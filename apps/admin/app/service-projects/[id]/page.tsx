"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button } from "@nexus/ui";
import {
  AdminServiceProjectDto,
  ServiceDocumentVisibility,
  ServiceMilestoneStatus,
  ServiceProjectMemberRole,
  ServiceProjectStatus,
  StaffUserDto,
} from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { PROJECT_VARIANT, ServicesNav, fieldClass, formatDate, formatDateTime, toDateInput } from "../../components/services-nav";
import { confirmAction, useCan } from "../../lib/permissions";

/** Mirrors the backend rules; the API remains the authority and rejects anything else. */
const NEXT_STATUSES: Record<ServiceProjectStatus, ServiceProjectStatus[]> = {
  PLANNING: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "IN_REVIEW", "CANCELLED"],
  ON_HOLD: ["PLANNING", "IN_PROGRESS", "CANCELLED"],
  IN_REVIEW: ["IN_PROGRESS", "COMPLETED", "ON_HOLD"],
  COMPLETED: [],
  CANCELLED: [],
};

const MILESTONE_NEXT: Record<ServiceMilestoneStatus, ServiceMilestoneStatus[]> = {
  PENDING: ["IN_PROGRESS", "DONE", "CANCELLED"],
  IN_PROGRESS: ["PENDING", "DONE", "CANCELLED"],
  DONE: ["IN_PROGRESS"],
  CANCELLED: ["PENDING"],
};

const MILESTONE_VARIANT: Record<ServiceMilestoneStatus, "success" | "warning" | "error" | "info"> = {
  PENDING: "info",
  IN_PROGRESS: "warning",
  DONE: "success",
  CANCELLED: "error",
};

export default function AdminProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const can = useCan();
  const canManage = can("project.manage");
  const [project, setProject] = useState<AdminServiceProjectDto | null>(null);
  const [staff, setStaff] = useState<StaffUserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState({ title: "", summary: "", startDate: "", targetDate: "" });
  const [assignee, setAssignee] = useState({ userId: "", role: "MEMBER" as ServiceProjectMemberRole });
  const [milestone, setMilestone] = useState({ title: "", description: "", dueDate: "" });
  const [message, setMessage] = useState({ body: "", internal: false });
  const [docVisibility, setDocVisibility] = useState<ServiceDocumentVisibility>("INTERNAL");
  const fileInput = useRef<HTMLInputElement>(null);

  const apply = (p: AdminServiceProjectDto) => {
    setProject(p);
    setDetails({
      title: p.title,
      summary: p.summary || "",
      startDate: toDateInput(p.startDate),
      targetDate: toDateInput(p.targetDate),
    });
  };

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const client = getApiClient(token);
      apply(await client.adminGetServiceProject(id));
      setError(null);
      // Staff list needs project.manage; read-only viewers simply don't get the assign form.
      client
        .adminListServiceStaff()
        .then(setStaff)
        .catch(() => setStaff([]));
    } catch (err: any) {
      setError(err?.message || "Project not found");
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<AdminServiceProjectDto | void>) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (res) apply(res);
    } catch (err: any) {
      setActionError(err?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const client = () => getApiClient(token);
  const closed = project?.status === "COMPLETED" || project?.status === "CANCELLED";
  const memberIds = new Set(project?.members.map((m) => m.userId));

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      <ServicesNav title="Project" subtitle="Status, team, milestones, documents and communication" />

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{error}</div>
      ) : !project ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {actionError && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{actionError}</div>}

          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                  <span className="font-mono font-bold bg-gray-100 px-2 py-0.5 rounded">{project.projectCode}</span>
                  <span>{project.service.name}</span>
                  {project.inquiryNumber && <span>• from {project.inquiryNumber}</span>}
                </div>
                <h2 className="mt-2 text-2xl font-bold text-gray-900">{project.title}</h2>
                <p className="text-sm text-gray-500">
                  Customer: {project.customer.displayName || "—"} ({project.customer.email || "no email"})
                </p>
              </div>
              <div className="flex flex-col items-start md:items-end gap-2">
                <Badge variant={PROJECT_VARIANT[project.status]}>{project.status}</Badge>
                <div className="flex flex-wrap gap-2">
                  {NEXT_STATUSES[project.status].map((s) => (
                    <Button key={s} variant="outline" className="text-xs" disabled={busy || !canManage} onClick={() => {
                        if ((s === "COMPLETED" || s === "CANCELLED") && !confirmAction(`Move this project to ${s}? Closed projects become read-only and cannot be reopened.`)) return;
                        run(() => client().adminUpdateServiceProject(project.id, { status: s }));
                      }}>
                      → {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <form
              className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() =>
                  client().adminUpdateServiceProject(project.id, {
                    title: details.title.trim(),
                    summary: details.summary.trim() || null,
                    startDate: details.startDate || null,
                    targetDate: details.targetDate || null,
                  }),
                );
              }}
            >
              <label className="block text-xs font-semibold text-gray-700 md:col-span-2">
                Title
                <input required maxLength={200} value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                Start
                <input type="date" value={details.startDate} onChange={(e) => setDetails({ ...details, startDate: e.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                Target
                <input type="date" value={details.targetDate} onChange={(e) => setDetails({ ...details, targetDate: e.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-gray-700 md:col-span-4">
                Summary (visible to the customer)
                <textarea rows={2} maxLength={5000} value={details.summary} onChange={(e) => setDetails({ ...details, summary: e.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <div className="md:col-span-4 flex justify-end">
                <Button type="submit" variant="outline" className="text-xs" disabled={busy || !canManage}>
                  Save details
                </Button>
              </div>
            </form>
          </section>

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6 min-w-0">
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900">Milestones</h3>
                <ul className="mt-4 space-y-3">
                  {project.milestones.map((m) => (
                    <li key={m.id} className="p-3 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900">{m.title}</div>
                          <div className="text-xs text-gray-500">
                            Due {formatDate(m.dueDate)}
                            {m.completedAt ? ` • done ${formatDate(m.completedAt)}` : ""}
                          </div>
                        </div>
                        <Badge variant={MILESTONE_VARIANT[m.status]}>{m.status}</Badge>
                      </div>
                      {m.description && <p className="mt-1 text-sm text-gray-600">{m.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {MILESTONE_NEXT[m.status].map((s) => (
                          <Button
                            key={s}
                            variant="outline"
                            className="text-xs"
                            disabled={busy || !canManage}
                            onClick={() => run(() => client().adminUpdateMilestone(project.id, m.id, { status: s }))}
                          >
                            → {s}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                  {project.milestones.length === 0 && <li className="text-sm text-gray-500">No milestones yet.</li>}
                </ul>
                {!closed && (
                  <form
                    className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_160px] gap-2 border-t border-gray-100 pt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        const res = await client().adminCreateMilestone(project.id, {
                          title: milestone.title.trim(),
                          description: milestone.description.trim() || undefined,
                          dueDate: milestone.dueDate || undefined,
                          sortOrder: project.milestones.length,
                        });
                        setMilestone({ title: "", description: "", dueDate: "" });
                        return res;
                      });
                    }}
                  >
                    <label className="sr-only" htmlFor="ms-title">
                      Milestone title
                    </label>
                    <input id="ms-title" required maxLength={200} placeholder="New milestone title" value={milestone.title} onChange={(e) => setMilestone({ ...milestone, title: e.target.value })} className={fieldClass} />
                    <label className="sr-only" htmlFor="ms-due">
                      Due date
                    </label>
                    <input id="ms-due" type="date" value={milestone.dueDate} onChange={(e) => setMilestone({ ...milestone, dueDate: e.target.value })} className={fieldClass} />
                    <label className="sr-only" htmlFor="ms-desc">
                      Description
                    </label>
                    <input id="ms-desc" maxLength={2000} placeholder="Description (optional)" value={milestone.description} onChange={(e) => setMilestone({ ...milestone, description: e.target.value })} className={`${fieldClass} md:col-span-2`} />
                    <div className="md:col-span-2 flex justify-end">
                      <Button type="submit" variant="primary" className="text-xs" disabled={busy || !canManage}>
                        Add milestone
                      </Button>
                    </div>
                  </form>
                )}
              </section>

              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900">Messages</h3>
                <div className="mt-4 space-y-3">
                  {project.messages.length === 0 && <p className="text-sm text-gray-500">No messages yet.</p>}
                  {project.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-3 rounded-xl text-sm ${m.isInternalNote ? "bg-amber-50 border border-amber-200" : m.senderType === "CUSTOMER" ? "bg-blue-50" : "bg-gray-50"}`}
                    >
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span className="font-semibold">
                          {m.senderName || m.senderType}
                          {m.isInternalNote && " • internal note"}
                        </span>
                        <span>{formatDateTime(m.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-line text-gray-800">{m.body}</p>
                    </div>
                  ))}
                </div>
                <form
                  className="mt-4 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      const res = await client().adminPostProjectMessage(project.id, { body: message.body.trim(), isInternalNote: message.internal });
                      setMessage({ body: "", internal: message.internal });
                      return res;
                    });
                  }}
                >
                  <label className="sr-only" htmlFor="staff-message">
                    Message
                  </label>
                  <textarea id="staff-message" required rows={3} maxLength={5000} value={message.body} onChange={(e) => setMessage({ ...message, body: e.target.value })} className={fieldClass} />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={message.internal} onChange={(e) => setMessage({ ...message, internal: e.target.checked })} />
                      Internal note (hidden from customer)
                    </label>
                    <Button type="submit" variant="primary" className="text-xs" disabled={busy || !canManage || !message.body.trim()}>
                      Send
                    </Button>
                  </div>
                </form>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900">Team</h3>
                <ul className="mt-3 space-y-2">
                  {project.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{m.displayName || m.email}</div>
                        <div className="text-xs text-gray-500">{m.role}</div>
                      </div>
                      <Button variant="ghost" className="text-xs text-red-600" disabled={busy || !canManage} onClick={() => {
                        if (!confirmAction(`Remove ${m.displayName || m.email || "this member"} from the project?`)) return;
                        run(() => client().adminRemoveProjectMember(project.id, m.userId!));
                      }}>
                        Remove
                      </Button>
                    </li>
                  ))}
                  {project.members.length === 0 && <li className="text-sm text-gray-500">No one assigned.</li>}
                </ul>
                {staff.length > 0 && (
                  <form
                    className="mt-4 space-y-2 border-t border-gray-100 pt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!assignee.userId) return;
                      run(() => client().adminAssignProjectMember(project.id, assignee));
                    }}
                  >
                    <label className="sr-only" htmlFor="assignee">
                      Staff member
                    </label>
                    <select id="assignee" value={assignee.userId} onChange={(e) => setAssignee({ ...assignee, userId: e.target.value })} className={fieldClass}>
                      <option value="">Select staff…</option>
                      {staff
                        .filter((s) => !memberIds.has(s.id))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.displayName || s.email} ({s.roles.join(", ")})
                          </option>
                        ))}
                    </select>
                    <div className="flex gap-2">
                      <label className="sr-only" htmlFor="assignee-role">
                        Role
                      </label>
                      <select id="assignee-role" value={assignee.role} onChange={(e) => setAssignee({ ...assignee, role: e.target.value as ServiceProjectMemberRole })} className={fieldClass}>
                        <option value="MEMBER">Member</option>
                        <option value="LEAD">Lead</option>
                      </select>
                      <Button type="submit" variant="primary" className="text-xs" disabled={busy || !canManage || !assignee.userId}>
                        Assign
                      </Button>
                    </div>
                  </form>
                )}
              </section>

              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900">Documents</h3>
                <div className="mt-3 flex gap-2">
                  <label className="sr-only" htmlFor="doc-visibility">
                    Visibility
                  </label>
                  <select id="doc-visibility" value={docVisibility} onChange={(e) => setDocVisibility(e.target.value as ServiceDocumentVisibility)} className={fieldClass}>
                    <option value="INTERNAL">Internal only</option>
                    <option value="CUSTOMER">Share with customer</option>
                  </select>
                  <Button variant="outline" className="text-xs" disabled={busy || !canManage} onClick={() => fileInput.current?.click()}>
                    Upload
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && (docVisibility === "INTERNAL" || confirmAction(`Share "${file.name}" with the customer?`))) {
                        run(() => client().adminUploadProjectDocument(project.id, file, docVisibility));
                      }
                      e.target.value = "";
                    }}
                  />
                </div>
                <ul className="mt-3 space-y-2">
                  {project.documents.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="w-full text-left p-2 rounded-lg border border-gray-100 hover:border-blue-300"
                        onClick={() =>
                          run(async () => {
                            const { url } = await client().adminGetProjectDocumentUrl(project.id, d.id);
                            window.open(url, "_blank", "noopener,noreferrer");
                          })
                        }
                      >
                        <span className="block text-sm font-medium text-gray-800 truncate">{d.fileName}</span>
                        <span className="block text-xs text-gray-500">
                          {d.visibility === "INTERNAL" ? "Internal" : "Shared"} • {d.uploaderType} • {formatDate(d.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {project.documents.length === 0 && <li className="text-sm text-gray-500">No documents.</li>}
                </ul>
              </section>

              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900">History</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {project.events.map((e) => (
                    <li key={e.id}>
                      <span className="font-medium text-gray-800">{e.type}</span>
                      {e.fromStatus && e.toStatus && (
                        <span className="text-gray-500">
                          {" "}
                          {e.fromStatus} → {e.toStatus}
                        </span>
                      )}
                      <span className="block text-xs text-gray-400">{formatDateTime(e.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
