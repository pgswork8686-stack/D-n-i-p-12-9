"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { TicketDto, TicketPriority, TicketStatus } from "@nexus/contracts";
import { Badge } from "@nexus/ui";
import { useAuth } from "../../../context/auth-context";
import { AdminApiError, adminFetch } from "../../../lib/admin-http";
import { confirmAction, useCan } from "../../../lib/permissions";
import {
  ADMIN_TICKET_PRIORITIES,
  ADMIN_TICKET_STATUSES,
  adminTicketPriorityLabel,
  adminTicketSenderLabel,
  adminTicketStatusLabel,
  validateAdminReply,
} from "../../../lib/admin-tickets";

export default function AdminTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { token, isLoading: authLoading } = useAuth();
  const can = useCan();
  const canManage = can("ticket.manage");
  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      setTicket(await adminFetch<TicketDto>("/admin/tickets/" + encodeURIComponent(id), token, "ticket"));
    } catch (cause) {
      setTicket(null);
      setError(cause instanceof AdminApiError ? cause.message : "Không tải được ticket.");
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setError("Vui lòng đăng nhập bằng tài khoản được cấp quyền xem ticket.");
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, token, load]);

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "ok", text: okText });
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof AdminApiError ? cause.message : "Thao tác không thành công." });
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !ticket) return;
    const problem = validateAdminReply(reply);
    if (problem) { setNotice({ tone: "error", text: problem }); return; }
    await run(async () => {
      await adminFetch("/admin/tickets/" + encodeURIComponent(ticket.id) + "/reply", token, "ticket", {
        method: "POST",
        body: JSON.stringify({ body: reply.trim(), isInternalNote: internal }),
      });
      setReply("");
    }, internal ? "Đã lưu ghi chú nội bộ." : "Đã gửi phản hồi cho khách.");
  };

  const update = async (patch: { status?: TicketStatus; priority?: TicketPriority }, okText: string) => {
    if (!token || !ticket) return;
    await run(() => adminFetch("/admin/tickets/" + encodeURIComponent(ticket.id), token, "ticket", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }), okText);
  };

  const closeTicket = () => {
    if (!confirmAction("Đóng ticket này? Khách hàng sẽ nhận thông báo ticket đã đóng.")) return;
    void update({ status: "CLOSED" }, "Đã đóng ticket.");
  };

  const closed = ticket?.status === "CLOSED";
  const messages = ticket?.messages ?? [];

  return (
    <main id="main" className="mx-auto max-w-5xl px-5 py-10 text-slate-900">
      <Link href="/admin/tickets" className="text-sm font-semibold text-blue-700 hover:underline">← Danh sách ticket</Link>

      {authLoading || loading ? (
        <div role="status" className="mt-6 rounded-2xl border bg-white p-8 text-slate-600">Đang tải ticket…</div>
      ) : error || !ticket ? (
        <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
          <p className="font-semibold">{error ?? "Không tìm thấy ticket."}</p>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold">Thử lại</button>
        </div>
      ) : (
        <>
          <header className="mt-4 border-b pb-5">
            <h1 className="text-2xl font-bold">{ticket.subject}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <Badge variant={closed || ticket.status === "RESOLVED" ? "success" : ticket.status === "WAITING_STAFF" ? "warning" : "info"}>
                {adminTicketStatusLabel(ticket.status)}
              </Badge>
              <span className="font-mono">{ticket.ticketNumber}</span>
              <span>Tạo {new Date(ticket.createdAt).toLocaleString("vi-VN")}</span>
              <span>Ưu tiên: {adminTicketPriorityLabel(ticket.priority)}</span>
            </p>
          </header>

          {notice && (
            <div role={notice.tone === "error" ? "alert" : "status"}
              className={"mt-5 rounded-xl border p-4 text-sm " + (notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
              {notice.text}
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <section aria-label="Hội thoại" className="space-y-4">
              <ol className="space-y-3">
                {messages.length === 0 && <li className="rounded-2xl border bg-white p-6 text-sm text-slate-500">Chưa có tin nhắn.</li>}
                {messages.map(m => (
                  <li key={m.id} className={"rounded-2xl border p-4 " +
                    (m.isInternalNote ? "border-dashed border-amber-400 bg-amber-50" : m.senderType === "STAFF" ? "bg-blue-50" : "bg-white")}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <strong className={m.isInternalNote ? "text-amber-800" : "text-slate-900"}>{adminTicketSenderLabel(m.senderType, m.isInternalNote)}</strong>
                      <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString("vi-VN")}</time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>
                    {m.isInternalNote && <p className="mt-2 text-xs text-amber-800">Chỉ nhân viên nhìn thấy — khách hàng không thấy ghi chú này.</p>}
                    {(m.attachments?.length ?? 0) > 0 && (
                      <ul className="mt-2 text-xs text-slate-600">
                        {m.attachments!.map(a => <li key={a.id}>{a.fileName} · {Math.ceil(a.sizeBytes / 1024)} KB</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>

              <form onSubmit={sendReply} className="rounded-2xl border bg-white p-5" aria-label="Trả lời khách">
                <label htmlFor="reply-body" className="text-sm font-semibold">Trả lời khách</label>
                <textarea id="reply-body" value={reply} onChange={e => setReply(e.target.value)}
                  disabled={!canManage || busy || closed} rows={4}
                  className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                  placeholder="Nhập nội dung phản hồi…" />
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} disabled={!canManage || busy || closed} />
                  Ghi chú nội bộ (khách không thấy)
                </label>
                <p className="mt-2 text-xs text-slate-500">
                  {internal ? "Ghi chú nội bộ không thay đổi trạng thái ticket." : "Phản hồi công khai sẽ chuyển ticket sang trạng thái “Đã phản hồi” (chờ khách)."}
                </p>
                {!canManage && <p className="mt-2 text-xs text-red-700">Bạn chỉ có quyền xem ticket (cần quyền quản lý ticket để trả lời).</p>}
                {closed && <p className="mt-2 text-xs text-slate-600">Ticket đã đóng — không thể trả lời.</p>}
                <button type="submit" disabled={!canManage || busy || closed || !reply.trim()}
                  className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? "Đang gửi…" : internal ? "Lưu ghi chú" : "Gửi phản hồi"}
                </button>
              </form>
            </section>

            <aside className="space-y-4" aria-label="Quản lý ticket">
              <section className="rounded-2xl border bg-white p-5">
                <h2 className="font-semibold">Trạng thái ticket</h2>
                <label htmlFor="t-status" className="mt-3 block text-xs font-semibold text-slate-600">Trạng thái</label>
                <select id="t-status" value={ticket.status} disabled={!canManage || busy}
                  onChange={e => void update({ status: e.target.value as TicketStatus }, "Đã cập nhật trạng thái.")}
                  className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm">
                  {ADMIN_TICKET_STATUSES.filter(s => s.value).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <label htmlFor="t-priority" className="mt-3 block text-xs font-semibold text-slate-600">Ưu tiên</label>
                <select id="t-priority" value={ticket.priority} disabled={!canManage || busy}
                  onChange={e => void update({ priority: e.target.value as TicketPriority }, "Đã cập nhật độ ưu tiên.")}
                  className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm">
                  {ADMIN_TICKET_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <button type="button" onClick={closeTicket} disabled={!canManage || busy || closed}
                  className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                  Đóng ticket
                </button>
              </section>

              <section className="rounded-2xl border bg-white p-5 text-sm">
                <h2 className="font-semibold">Ngữ cảnh khách hàng</h2>
                <dl className="mt-3 space-y-2">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Khách (ID)</dt><dd className="font-mono text-xs">{ticket.userId}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Danh mục</dt><dd>{ticket.category}</dd></div>
                  {ticket.orderId && <div className="flex justify-between gap-3"><dt className="text-slate-500">Đơn hàng</dt><dd><Link className="font-mono text-xs text-blue-700 hover:underline" href={`/admin/orders/${ticket.orderId}`}>{ticket.orderId}</Link></dd></div>}
                  {ticket.entitlementId && <div className="flex justify-between gap-3"><dt className="text-slate-500">Quyền sử dụng</dt><dd className="font-mono text-xs">{ticket.entitlementId}</dd></div>}
                </dl>
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
