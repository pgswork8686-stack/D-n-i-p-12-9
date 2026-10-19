"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@nexus/ui";
import { useAuth } from "../../../../context/auth-context";
import { AdminApiError, adminFetch } from "../../../../lib/admin-http";
import { confirmAction, useCan } from "../../../../lib/permissions";
import { useAdminQuery } from "../../../../lib/use-admin-query";
import {
  adminVersionStatusLabel,
  formatBytes,
  parseAdminVersion,
  parseAdminVersionList,
  publishBlockReason,
  shortSha,
  sortAdminVersions,
  validateUploadFile,
  validateVersionLabel,
} from "../../../../lib/admin-versions";

const fmt = (value?: string | null) => (value ? new Date(value).toLocaleDateString("vi-VN") : "—");

export default function AdminProductVersionsPage() {
  const params = useParams<{ id: string }>();
  const productId = decodeURIComponent(String(params?.id ?? ""));
  const { token } = useAuth();
  const can = useCan();
  const canWrite = can("product.write");
  const canPublish = can("product.publish");
  const list = useAdminQuery("/admin/products/" + encodeURIComponent(productId) + "/versions", "phiên bản", parseAdminVersionList);
  const versions = sortAdminVersions(list.data ?? []);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedId = pickedId && versions.some(v => v.id === pickedId) ? pickedId : versions[0]?.id ?? null;
  const detail = useAdminQuery(selectedId ? "/admin/product-versions/" + encodeURIComponent(selectedId) : null, "chi tiết phiên bản", parseAdminVersion);
  const version = detail.data && detail.data.id === selectedId ? detail.data : null;

  const [newVersion, setNewVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [primary, setPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = async (work: () => Promise<void>, okText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      setNotice({ tone: "ok", text: okText });
      list.reload();
      detail.reload();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof AdminApiError ? cause.message : "Thao tác không thành công." });
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    const problem = validateVersionLabel(newVersion);
    if (problem) { setNotice({ tone: "error", text: problem }); return; }
    await run(async () => {
      const created = await adminFetch<{ id: string }>("/admin/products/" + encodeURIComponent(productId) + "/versions", token, "phiên bản", {
        method: "POST",
        body: JSON.stringify({ version: newVersion.trim(), ...(notes.trim() ? { releaseNotes: notes.trim() } : {}) }),
      });
      setPickedId(created.id);
      setNewVersion("");
      setNotes("");
    }, "Đã tạo phiên bản nháp.");
  };

  const upload = async () => {
    if (!token || !version) return;
    const problem = validateUploadFile(file);
    if (problem || !file) { setNotice({ tone: "error", text: problem ?? "Chọn tệp để tải lên." }); return; }
    await run(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("isPrimary", primary ? "true" : "false");
      await adminFetch("/admin/product-versions/" + encodeURIComponent(version.id) + "/files/upload", token, "tệp phiên bản", { method: "POST", body: form });
      setFile(null);
    }, "Đã tải lên. Máy chủ tự tính SHA-256 và dung lượng.");
  };

  const publish = async () => {
    if (!token || !version) return;
    if (!confirmAction("Phát hành phiên bản " + version.version + "? Sau khi phát hành sẽ không thể sửa hay xóa tệp.")) return;
    await run(async () => {
      await adminFetch("/admin/product-versions/" + encodeURIComponent(version.id) + "/publish", token, "phiên bản", { method: "POST" });
    }, "Đã phát hành phiên bản.");
  };

  const block = version ? publishBlockReason(version) : null;
  const isDraft = version?.status === "DRAFT";

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <Link href={`/admin/products/${encodeURIComponent(productId)}`} className="text-sm font-semibold text-blue-700 hover:underline">← Sản phẩm</Link>
          <h1 className="mt-3 text-3xl font-bold">Phiên bản &amp; file</h1>
          <p className="mt-2 text-sm text-slate-600">Phiên bản đã phát hành là bất biến. Tệp chính phải được xác minh SHA-256 trước khi phát hành.</p>
        </div>
        <button type="button" onClick={() => { list.reload(); detail.reload(); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Tải lại</button>
      </header>

      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"}
          className={"mt-5 rounded-xl border p-4 text-sm " + (notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
          {notice.text}
        </div>
      )}

      {list.loading ? (
        <div role="status" className="mt-6 rounded-2xl border bg-white p-8 text-slate-600">Đang tải phiên bản…</div>
      ) : list.error ? (
        <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
          <p className="font-semibold">{list.error}</p>
          <button type="button" onClick={list.reload} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
          {!list.signedIn && <Link href="/login" className="ml-4 text-sm font-semibold underline">Đăng nhập</Link>}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-4" aria-label="Danh sách phiên bản">
            <section className="rounded-2xl border bg-white p-5">
              <h2 className="font-semibold">Danh sách phiên bản</h2>
              {versions.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Chưa có phiên bản nào. Tạo phiên bản đầu tiên bên dưới.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {versions.map(v => (
                    <li key={v.id}>
                      <button type="button" onClick={() => setPickedId(v.id)} aria-current={v.id === selectedId}
                        className={"flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm " + (v.id === selectedId ? "border-blue-500 bg-blue-50" : "hover:bg-slate-50")}>
                        <span><span className="block font-semibold">v{v.version}</span><span className="block text-xs text-slate-500">{v.status === "PUBLISHED" ? fmt(v.releasedAt) : "Chưa phát hành"}</span></span>
                        <Badge variant={v.status === "PUBLISHED" ? "success" : "warning"}>{adminVersionStatusLabel(v.status)}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <form onSubmit={create} className="rounded-2xl border bg-white p-5" aria-label="Tạo phiên bản">
              <h2 className="font-semibold">Tạo phiên bản nháp</h2>
              <label htmlFor="v-label" className="mt-3 block text-xs font-semibold text-slate-600">Số phiên bản</label>
              <input id="v-label" value={newVersion} onChange={e => setNewVersion(e.target.value)} placeholder="VD: 3.4.0" disabled={!canWrite || busy}
                className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" />
              <label htmlFor="v-notes" className="mt-3 block text-xs font-semibold text-slate-600">Ghi chú phát hành (không bắt buộc)</label>
              <textarea id="v-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} disabled={!canWrite || busy}
                className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" />
              <button type="submit" disabled={!canWrite || busy || !newVersion.trim()}
                className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Tạo phiên bản</button>
              {!canWrite && <p className="mt-2 text-xs text-red-700">Cần quyền ghi sản phẩm để tạo phiên bản.</p>}
            </form>
          </aside>

          <section aria-label="Chi tiết phiên bản" className="space-y-4">
            {!selectedId ? (
              <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Chọn hoặc tạo một phiên bản để quản lý tệp.</div>
            ) : detail.loading ? (
              <div role="status" className="rounded-2xl border bg-white p-8 text-slate-600">Đang tải phiên bản…</div>
            ) : detail.error || !version ? (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
                <p className="font-semibold">{detail.error ?? "Không tải được phiên bản."}</p>
                <button type="button" onClick={detail.reload} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
              </div>
            ) : (
              <>
                <section className="rounded-2xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold">Phiên bản {version.version} · Tệp</h2>
                    <Badge variant={version.status === "PUBLISHED" ? "success" : "warning"}>{adminVersionStatusLabel(version.status)}</Badge>
                  </div>
                  {version.releaseNotes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{version.releaseNotes}</p>}

                  {isDraft && (
                    <div className="mt-4 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 p-5">
                      <label htmlFor="v-file" className="block text-sm font-semibold">Kéo thả hoặc chọn tệp .zip</label>
                      <input id="v-file" type="file" accept=".zip,application/zip" disabled={!canWrite || busy}
                        onChange={e => setFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" />
                      <p className="mt-2 text-xs text-slate-600">Máy chủ tự tạo đường dẫn lưu trữ và tính SHA-256. Giới hạn mặc định 50 MB.</p>
                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} disabled={!canWrite || busy} />
                        Đánh dấu là tệp chính
                      </label>
                      <button type="button" onClick={() => void upload()} disabled={!canWrite || busy || !file}
                        className="mt-3 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                        {busy ? "Đang tải lên…" : "Tải lên"}
                      </button>
                    </div>
                  )}

                  <div className="mt-4 overflow-x-auto rounded-2xl border">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="border-b bg-slate-50 text-slate-600">
                        <tr>
                          <th scope="col" className="px-4 py-3">Tệp</th>
                          <th scope="col" className="px-4 py-3">Dung lượng</th>
                          <th scope="col" className="px-4 py-3">SHA-256</th>
                          <th scope="col" className="px-4 py-3">Xác minh</th>
                          <th scope="col" className="px-4 py-3">Vai trò</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(version.files ?? []).length === 0 && (
                          <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Chưa có tệp.</td></tr>
                        )}
                        {(version.files ?? []).map(f => (
                          <tr key={f.id}>
                            <td className="px-4 py-3 font-semibold">{f.fileName}</td>
                            <td className="px-4 py-3">{formatBytes(f.sizeBytes)}</td>
                            <td className="px-4 py-3 font-mono text-xs">{shortSha(f.sha256)}</td>
                            <td className="px-4 py-3"><Badge variant={f.verifiedAt ? "success" : "warning"}>{f.verifiedAt ? "Đã xác minh" : "Đang kiểm tra"}</Badge></td>
                            <td className="px-4 py-3">{f.isPrimary ? <Badge variant="info">Tệp chính</Badge> : "Phụ"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border bg-white p-5">
                  <h2 className="font-semibold">Phát hành phiên bản {version.version}</h2>
                  <p className="mt-1 text-sm text-slate-600">Máy chủ kiểm tra lại toàn vẹn tệp trước khi chuyển sang Đã phát hành. Sau đó không thể sửa hay xóa.</p>
                  {block && <p className="mt-2 text-xs text-amber-800">{block}</p>}
                  <button type="button" onClick={() => void publish()} disabled={!canPublish || busy || Boolean(block)}
                    className="mt-3 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? "Đang xử lý…" : "Phát hành"}
                  </button>
                  {!canPublish && <p className="mt-2 text-xs text-red-700">Cần quyền phát hành sản phẩm.</p>}
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
