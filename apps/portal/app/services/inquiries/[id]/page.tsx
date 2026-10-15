"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@nexus/ui";
import { ServiceInquiryDto } from "@nexus/contracts";
import { useAuth } from "../../../context/auth-context";
import { getApiClient } from "../../../lib/api";
import { AuthGuard } from "../../../components/auth-guard";
import { PortalShell } from "../../../components/portal-shell";
import { Skeleton } from "../../../components/skeleton";
import { ErrorState } from "../../../components/error-state";
import { INQUIRY_STATUS_LABELS, formatBytes, formatDate } from "../../labels";

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [inquiry, setInquiry] = useState<ServiceInquiryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      setInquiry(await getApiClient(token).getMyServiceInquiry(id));
    } catch (err: any) {
      setError(err?.message || "Request not found");
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  const openAttachment = async (attachmentId: string) => {
    if (!token || !inquiry) return;
    try {
      const { url } = await getApiClient(token).getMyInquiryAttachmentUrl(inquiry.id, attachmentId);
      // Signed URLs are served as attachments: navigating downloads without leaving the page
      // and is not blocked like a popup opened after an await.
      window.location.assign(url);
    } catch (err: any) {
      setError(err?.message || "Failed to open attachment");
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="max-w-3xl mx-auto space-y-6">
          <Link href="/services" className="text-sm text-slate-500 hover:text-[#0037b0]">
            ← Service Projects
          </Link>
          {loading ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : error || !inquiry ? (
            <ErrorState title="Request unavailable" message={error || "Request not found"} onRetry={load} />
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    {inquiry.inquiryNumber}
                  </span>
                  <h1 className="mt-2 text-xl font-bold text-slate-900">{inquiry.service.name}</h1>
                  <p className="text-xs text-slate-400 mt-1">Submitted {formatDate(inquiry.createdAt)}</p>
                </div>
                <Badge variant={inquiry.status === "REJECTED" ? "error" : inquiry.status === "QUALIFIED" ? "success" : "warning"}>
                  {INQUIRY_STATUS_LABELS[inquiry.status]}
                </Badge>
              </div>

              {inquiry.projectId && (
                <Link
                  href={`/services/projects/${inquiry.projectId}`}
                  className="block p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800"
                >
                  A project was created from this request → view project
                </Link>
              )}

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">Company</dt>
                  <dd className="text-slate-800">{inquiry.companyName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Contact</dt>
                  <dd className="text-slate-800">
                    {inquiry.contactName} • {inquiry.contactEmail}
                    {inquiry.contactPhone ? ` • ${inquiry.contactPhone}` : ""}
                  </dd>
                </div>
              </dl>

              <div>
                <h2 className="text-sm font-semibold text-slate-700">Requirements</h2>
                <p className="mt-1 text-sm text-slate-800 whitespace-pre-line">{inquiry.requirements}</p>
              </div>

              {inquiry.desiredFeatures.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-700">Desired features</h2>
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
                    {inquiry.desiredFeatures.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {inquiry.attachments.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-700">Attachments</h2>
                  <ul className="mt-2 space-y-2">
                    {inquiry.attachments.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => openAttachment(a.id)}
                          className="text-sm text-[#0037b0] hover:underline"
                        >
                          {a.fileName}
                        </button>
                        <span className="text-xs text-slate-400"> • {formatBytes(a.sizeBytes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
