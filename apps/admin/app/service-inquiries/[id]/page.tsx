"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button } from "@nexus/ui";
import { AdminServiceInquiryDto, ServiceInquiryStatus } from "@nexus/contracts";
import { useAuth } from "../../context/auth-context";
import { getApiClient } from "../../lib/api";
import { INQUIRY_VARIANT, ServicesNav, fieldClass, formatDateTime } from "../../components/services-nav";
import { confirmAction, useCan } from "../../lib/permissions";

/** Mirrors the backend rules; the API remains the authority and rejects anything else. */
const NEXT_STATUSES: Record<ServiceInquiryStatus, ServiceInquiryStatus[]> = {
  NEW: ["REVIEWING", "QUALIFIED", "REJECTED", "SPAM"],
  REVIEWING: ["QUALIFIED", "REJECTED", "SPAM"],
  QUALIFIED: ["REVIEWING", "REJECTED"],
  REJECTED: ["REVIEWING"],
  SPAM: ["REVIEWING"],
  CONVERTED: [],
};

const BUDGET_LABELS: Record<string, string> = {
  UNDER_20M: "< 20M VND",
  FROM_20M_TO_50M: "20–50M VND",
  FROM_50M_TO_100M: "50–100M VND",
  FROM_100M_TO_300M: "100–300M VND",
  OVER_300M: "> 300M VND",
  UNDECIDED: "Undecided",
};

const TIMELINE_LABELS: Record<string, string> = {
  ASAP: "ASAP",
  WITHIN_1_MONTH: "Within 1 month",
  ONE_TO_THREE_MONTHS: "1–3 months",
  THREE_TO_SIX_MONTHS: "3–6 months",
  FLEXIBLE: "Flexible",
};

export default function AdminInquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const can = useCan();
  const canManage = can("inquiry.manage");
  // Must match the API: POST …/convert requires both permissions.
  const canConvert = can("inquiry.manage", "project.manage");
  const [inquiry, setInquiry] = useState<AdminServiceInquiryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [convert, setConvert] = useState({ title: "", summary: "", customerEmail: "", startDate: "", targetDate: "" });

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const res = await getApiClient(token).adminGetServiceInquiry(id);
      setInquiry(res);
      setNote(res.staffNote || "");
      setConvert((c) => ({ ...c, title: c.title || `${res.companyName} — ${res.service.name}` }));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Inquiry not found");
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err: any) {
      setActionError(err?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (status: ServiceInquiryStatus) => {
    if ((status === "REJECTED" || status === "SPAM") && !confirmAction(`Mark this inquiry as ${status}?`)) return;
    return run(async () => {
      setInquiry(await getApiClient(token).adminUpdateServiceInquiry(id, { status }));
    });
  };

  const saveNote = () =>
    run(async () => {
      setInquiry(await getApiClient(token).adminUpdateServiceInquiry(id, { staffNote: note.trim() || null }));
    });

  const doConvert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmAction("Create a project from this inquiry? The inquiry becomes CONVERTED and cannot be changed afterwards.")) return;
    run(async () => {
      const project = await getApiClient(token).adminConvertServiceInquiry(id, {
        title: convert.title.trim() || undefined,
        summary: convert.summary.trim() || undefined,
        customerEmail: inquiry?.userId ? undefined : convert.customerEmail.trim() || undefined,
        startDate: convert.startDate || undefined,
        targetDate: convert.targetDate || undefined,
      });
      router.push(`/service-projects/${project.id}`);
    });
  };

  return (
    <main className="max-w-6xl mx-auto py-10 px-6 font-sans">
      <ServicesNav title="Inquiry" subtitle="Review the request and decide the next step" />

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{error}</div>
      ) : !inquiry ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6 min-w-0">
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="font-mono text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{inquiry.inquiryNumber}</span>
                  <h2 className="mt-2 text-xl font-bold text-gray-900">{inquiry.companyName}</h2>
                  <p className="text-sm text-gray-500">
                    {inquiry.service.name} • {formatDateTime(inquiry.createdAt)}
                  </p>
                </div>
                <Badge variant={INQUIRY_VARIANT[inquiry.status]}>{inquiry.status}</Badge>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-gray-400">Contact</dt>
                  <dd className="text-gray-800">{inquiry.contactName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Email / phone</dt>
                  <dd className="text-gray-800 break-all">
                    {inquiry.contactEmail}
                    {inquiry.contactPhone ? ` • ${inquiry.contactPhone}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Budget</dt>
                  <dd className="text-gray-800">{inquiry.budgetRange ? BUDGET_LABELS[inquiry.budgetRange] : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Timeline</dt>
                  <dd className="text-gray-800">{inquiry.timeline ? TIMELINE_LABELS[inquiry.timeline] : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Account</dt>
                  <dd className="text-gray-800">{inquiry.userId ? "Signed-in customer" : "Anonymous (no account linked)"}</dd>
                </div>
              </dl>
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Requirements</h3>
                <p className="mt-1 text-sm text-gray-800 whitespace-pre-line">{inquiry.requirements}</p>
              </div>
              {inquiry.desiredFeatures.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Desired features</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                    {inquiry.desiredFeatures.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {inquiry.attachments.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Attachments</h3>
                  <ul className="mt-2 space-y-1">
                    {inquiry.attachments.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          className="text-sm text-[#0037b0] hover:underline"
                          onClick={() =>
                            run(async () => {
                              const { url } = await getApiClient(token).adminGetInquiryAttachmentUrl(inquiry.id, a.id);
                              // Signed URLs are served as attachments: navigating downloads without leaving the page
                              // and is not blocked like a popup opened after an await.
                              window.location.assign(url);
                            })
                          }
                        >
                          {a.fileName}
                        </button>
                        <span className="text-xs text-gray-400"> • {a.mimeType}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <label htmlFor="staff-note" className="text-sm font-semibold text-gray-700">
                Staff note <span className="font-normal text-gray-400">(internal)</span>
              </label>
              <textarea id="staff-note" rows={4} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} mt-2`} />
              <div className="mt-2 flex justify-end">
                <Button variant="outline" className="text-xs" disabled={busy || !canManage} onClick={saveNote}>
                  Save note
                </Button>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            {actionError && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{actionError}</div>}

            {inquiry.status === "CONVERTED" && inquiry.projectId ? (
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <p className="text-sm text-gray-700">This inquiry has been converted.</p>
                <Link href={`/service-projects/${inquiry.projectId}`} className="mt-3 inline-block text-sm font-semibold text-[#0037b0] hover:underline">
                  Open project →
                </Link>
              </section>
            ) : (
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-gray-700">Change status</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {NEXT_STATUSES[inquiry.status].map((s) => (
                    <Button key={s} variant="outline" className="text-xs" disabled={busy || !canManage} onClick={() => changeStatus(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {inquiry.status === "QUALIFIED" && (
              <form onSubmit={doConvert} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Convert to project</h3>
                {!canConvert && <p className="text-xs text-gray-500">Requires inquiry.manage and project.manage.</p>}
                <label className="block text-xs font-semibold text-gray-700">
                  Project title
                  <input required maxLength={200} value={convert.title} onChange={(e) => setConvert({ ...convert, title: e.target.value })} className={`${fieldClass} mt-1`} />
                </label>
                <label className="block text-xs font-semibold text-gray-700">
                  Summary
                  <textarea rows={3} maxLength={5000} value={convert.summary} onChange={(e) => setConvert({ ...convert, summary: e.target.value })} className={`${fieldClass} mt-1`} />
                </label>
                {!inquiry.userId && (
                  <label className="block text-xs font-semibold text-gray-700">
                    Customer account email
                    <input
                      required
                      type="email"
                      value={convert.customerEmail}
                      onChange={(e) => setConvert({ ...convert, customerEmail: e.target.value })}
                      placeholder={inquiry.contactEmail}
                      className={`${fieldClass} mt-1`}
                    />
                    <span className="mt-1 block font-normal text-gray-500">
                      Anonymous request: enter the email of an existing account that will own the project.
                    </span>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    Start
                    <input type="date" value={convert.startDate} onChange={(e) => setConvert({ ...convert, startDate: e.target.value })} className={`${fieldClass} mt-1`} />
                  </label>
                  <label className="block text-xs font-semibold text-gray-700">
                    Target
                    <input type="date" value={convert.targetDate} onChange={(e) => setConvert({ ...convert, targetDate: e.target.value })} className={`${fieldClass} mt-1`} />
                  </label>
                </div>
                <Button type="submit" variant="primary" className="w-full" disabled={busy || !canConvert}>
                  {busy ? "Converting…" : "Create project"}
                </Button>
              </form>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
