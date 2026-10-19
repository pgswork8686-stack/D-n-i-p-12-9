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
import { buildProductLabels, formatViDateOrNull, productLabel } from "../lib/product-names";

interface EntitlementWithVersions {
  entitlement: EntitlementDto;
  versions: CustomerProductVersionDto[];
}

export default function DownloadsPage() {
  const { token } = useAuth();
  const [labels, setLabels] = useState(() => buildProductLabels([]));
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
      try { setLabels(buildProductLabels((await client.listOrders({ limit: 50 })).items || [])); } catch { /* names are optional */ }
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
      setError(err.message || "Không tải được Trung tâm tải xuống.");
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
        throw new Error("Không tạo được liên kết tải xuống.");
      }
    } catch (err: any) {
      setDownloadError(err.message || "Tải xuống thất bại. Vui lòng thử lại.");
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
              Trung tâm tải xuống
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Tải bản cài đặt mới nhất của các sản phẩm bạn đã mua, trong thời hạn cập nhật.
            </p>
          </div>

          {/* Security Guarantee Notice */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <span aria-hidden="true">🔒</span>
              <span>Liên kết tải xuống an toàn</span>
            </div>
            <p className="text-indigo-700 leading-relaxed">
              Mỗi lượt tải dùng một liên kết có chữ ký, hết hạn sau ít phút. Chúng tôi không công khai đường dẫn lưu trữ cố định.
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
              title="Chưa có bản tải xuống"
              description="Bạn chưa có sản phẩm nào đủ điều kiện tải xuống. Sản phẩm đã mua sẽ xuất hiện tại đây."
              actionText="Khám phá cửa hàng"
              actionHref={process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"}
            />
          ) : (
            <div className="space-y-8">
              {items.map(({ entitlement, versions }) => (
                <Card
                  key={entitlement.id}
                  title={productLabel(labels, entitlement.productId, entitlement.variantId).name}
                  subtitle={`Cập nhật đến: ${formatViDateOrNull(entitlement.updatesUntil, "Trọn đời")}`}
                  headerAction={<StatusBadge status={entitlement.status} kind="entitlement" />}
                >
                  {versions.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3">
                      Chưa có gói phát hành nào cho sản phẩm này.
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
                                <span>Phiên bản {ver.version}</span>
                                <span className="text-[11px] font-medium text-slate-400">
                                  (Phát hành {formatViDateOrNull(ver.releasedAt)})
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
                                        Bản chính
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                                    Dung lượng: {formatFileSize(file.sizeBytes)} • SHA-256:{" "}
                                    {file.sha256 ? `${file.sha256.slice(0, 16)}…` : "—"}
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
                                    "Đang tạo liên kết…"
                                  ) : (
                                    <span>Tải xuống</span>
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
