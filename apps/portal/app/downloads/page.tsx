"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/auth-context";
import { getApiClient } from "../lib/api";
import { AuthGuard } from "../components/auth-guard";
import { PortalShell } from "../components/portal-shell";
import { StatusBadge } from "../components/status-badge";
import { Skeleton } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { ErrorState } from "../components/error-state";
import { Button, Card } from "@nexus/ui";
import {
  EntitlementDto,
  CustomerProductVersionDto,
  CustomerProductVersionFileDto,
} from "@nexus/contracts";

interface EntitlementWithVersions {
  entitlement: EntitlementDto;
  versions: CustomerProductVersionDto[];
}

export default function DownloadsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<EntitlementWithVersions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchDownloadables = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const client = getApiClient(token);
      const entitlementsRes = await client.listEntitlements({ limit: 50 });
      const activeEntitlements = (entitlementsRes.items || []).filter(
        (e) => e.status === "ACTIVE",
      );

      const itemsWithVersions: EntitlementWithVersions[] = [];
      for (const ent of activeEntitlements) {
        try {
          const versions = await client.listEntitlementVersions(ent.id);
          itemsWithVersions.push({
            entitlement: ent,
            versions: versions || [],
          });
        } catch {
          // Skip or push empty versions
          itemsWithVersions.push({
            entitlement: ent,
            versions: [],
          });
        }
      }

      setItems(itemsWithVersions);
    } catch (err: any) {
      setError(err.message || "Failed to load downloads hub");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDownloadables();
  }, [fetchDownloadables]);

  const handleDownload = async (
    entitlementId: string,
    versionId: string,
    file: CustomerProductVersionFileDto,
  ) => {
    if (!token) return;
    setDownloadingFileId(file.id);
    setDownloadError(null);
    try {
      const client = getApiClient(token);
      const res = await client.requestDownload({
        entitlementId,
        versionId,
        fileId: file.id,
      });

      if (res && res.downloadUrl) {
        // Trigger browser download via signed URL
        const link = document.createElement("a");
        link.href = res.downloadUrl;
        link.download = res.fileName || file.fileName;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        throw new Error("Signed download URL was not generated.");
      }
    } catch (err: any) {
      setDownloadError(err.message || "Download failed. Please try again.");
    } finally {
      setDownloadingFileId(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="space-y-6 max-w-5xl">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Downloads Hub
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Secure, backend-signed download links for your purchased themes and plugins.
            </p>
          </div>

          {/* Security Guarantee Notice */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <span>🔒</span>
              <span>Secure Ephemeral Download Authority</span>
            </div>
            <p className="text-indigo-700 leading-relaxed">
              Downloads are streamed using short-lived signed URLs. No permanent public storage links
              or cloud storage credentials are ever exposed to the client.
            </p>
          </div>

          {error && <ErrorState message={error} onRetry={fetchDownloadables} />}
          {downloadError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-semibold">
              ⚠️ {downloadError}
            </div>
          )}

          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-48 w-full rounded-2xl" />
              <Skeleton className="h-48 w-full rounded-2xl" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="No Downloads Available"
              description="You do not have any active product entitlements eligible for download. Purchased products will appear here."
              actionText="Shop Marketplace"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <div className="space-y-8">
              {items.map(({ entitlement, versions }) => (
                <Card
                  key={entitlement.id}
                  title={`Product #${entitlement.productId.slice(0, 8)}`}
                  subtitle={`Entitlement: ${entitlement.id.slice(0, 8)} • Updates: ${
                    entitlement.updatesUntil
                      ? new Date(entitlement.updatesUntil).toLocaleDateString()
                      : "Lifetime"
                  }`}
                  headerAction={<StatusBadge status={entitlement.status} />}
                >
                  {versions.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3">
                      No published packages are currently available under this entitlement.
                    </p>
                  ) : (
                    <div className="space-y-4 pt-2">
                      {versions.map((ver) => (
                        <div
                          key={ver.id}
                          className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                              <div className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                                <span>Version {ver.version}</span>
                                <span className="text-[11px] font-medium text-slate-400">
                                  (Released{" "}
                                  {ver.releasedAt
                                    ? new Date(ver.releasedAt).toLocaleDateString()
                                    : "N/A"}
                                  )
                                </span>
                              </div>
                              {ver.releaseNotes && (
                                <p className="text-xs text-slate-600 mt-1">
                                  {ver.releaseNotes}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Version Files List */}
                          <div className="border-t border-slate-200/60 pt-3 space-y-2">
                            {ver.files?.map((file) => (
                              <div
                                key={file.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-lg border border-slate-200/80 shadow-xs"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold text-xs text-slate-800 flex items-center gap-2 truncate">
                                    <span>📄 {file.fileName}</span>
                                    {file.isPrimary && (
                                      <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded">
                                        Primary
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                                    Size: {formatFileSize(file.sizeBytes)} • SHA-256:{" "}
                                    {file.sha256 ? `${file.sha256.slice(0, 16)}...` : "N/A"}
                                  </div>
                                </div>

                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() =>
                                    handleDownload(entitlement.id, ver.id, file)
                                  }
                                  disabled={downloadingFileId === file.id}
                                  className="shrink-0"
                                >
                                  {downloadingFileId === file.id ? (
                                    "Presigning..."
                                  ) : (
                                    <span>Download File ⬇️</span>
                                  )}
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
