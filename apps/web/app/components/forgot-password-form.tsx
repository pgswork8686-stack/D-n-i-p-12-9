"use client";

import Link from "next/link";
import { useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { recoveryRedirectUrl } from "../lib/password-recovery";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = Boolean(getSupabaseClient());

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !configured) return;
    setSubmitting(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error("auth unavailable");
      const { error: authError } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: recoveryRedirectUrl(window.location.origin),
      });
      if (authError) {
        // Do not surface whether an email address belongs to an account.
        setError("Không thể gửi yêu cầu lúc này. Vui lòng thử lại sau.");
        return;
      }
      setSent(true);
    } catch {
      setError("Không kết nối được hệ thống xác thực. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-ink">Khôi phục mật khẩu</h1>
      {sent ? (
        <div role="status" className="mt-5 space-y-3 text-body">
          <p>Nếu email này có tài khoản, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu. Hãy kiểm tra hộp thư và thư rác.</p>
          <p>Liên kết khôi phục chỉ sử dụng được trong thời gian do hệ thống xác thực quy định.</p>
          <Link className="inline-flex font-semibold text-brand underline" href="/login">Quay lại đăng nhập</Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-muted">Nhập email của tài khoản để nhận liên kết đặt lại mật khẩu.</p>
          {!configured && <p role="alert" className="mt-4 text-danger">Hệ thống xác thực chưa được cấu hình.</p>}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="recovery-email" className="field-label">Email</label>
              <input
                id="recovery-email" type="email" autoComplete="email" required
                value={email} onChange={(event) => setEmail(event.target.value)}
                disabled={!configured || submitting} className="field-input"
              />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button className="btn-primary w-full" type="submit" disabled={!configured || submitting}>
              {submitting ? "Đang gửi…" : "Gửi liên kết khôi phục"}
            </button>
          </form>
          <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-brand hover:underline">Quay lại đăng nhập</Link>
        </>
      )}
    </div>
  );
}
