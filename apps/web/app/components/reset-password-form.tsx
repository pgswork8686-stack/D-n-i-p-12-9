"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { isRecoveryCallback, passwordValidationError } from "../lib/password-recovery";

type RecoveryState = "checking" | "ready" | "invalid" | "unavailable" | "complete";

export function ResetPasswordForm() {
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setState("unavailable");
      return;
    }
    const expectedRecovery = isRecoveryCallback(window.location.search, window.location.hash);
    let mounted = true;
    let eventConfirmed = false;
    // Subscribe synchronously before checking the session so the recovery
    // event cannot be missed during Supabase initialization.
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" && session?.access_token) {
        eventConfirmed = true;
        setState("ready");
      }
    });
    client.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (!sessionError && data.session?.access_token && (expectedRecovery || eventConfirmed)) {
          setState("ready");
        } else if (!eventConfirmed) {
          setState("invalid");
        }
      })
      .catch(() => mounted && !eventConfirmed && setState("invalid"));
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state !== "ready" || submitting) return;
    const problem = passwordValidationError(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error("auth unavailable");
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session) {
        setState("invalid");
        return;
      }
      const { error: authError } = await client.auth.updateUser({ password });
      if (authError) {
        setError("Không thể đổi mật khẩu. Liên kết có thể đã hết hạn; hãy yêu cầu liên kết mới.");
        return;
      }
      await client.auth.signOut({ scope: "local" }).catch(() => {});
      // Remove one-time callback parameters and tokens from the address bar.
      window.history.replaceState({}, "", "/reset-password");
      setPassword("");
      setConfirmation("");
      setState("complete");
    } catch {
      setError("Kết nối thất bại. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-ink">Đặt lại mật khẩu</h1>
      {state === "checking" && <p role="status" className="mt-4 text-muted">Đang xác minh liên kết khôi phục…</p>}
      {state === "unavailable" && <p role="alert" className="mt-4 text-danger">Hệ thống xác thực chưa được cấu hình.</p>}
      {state === "invalid" && (
        <div role="alert" className="mt-4 space-y-3">
          <p className="text-danger">Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.</p>
          <Link href="/forgot-password" className="font-semibold text-brand underline">Yêu cầu liên kết mới</Link>
        </div>
      )}
      {state === "complete" && (
        <div role="status" className="mt-4 space-y-3">
          <p>Mật khẩu đã được cập nhật. Vui lòng đăng nhập lại bằng mật khẩu mới.</p>
          <Link href="/login" className="font-semibold text-brand underline">Đăng nhập</Link>
        </div>
      )}
      {state === "ready" && (
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <p className="text-muted">Nhập mật khẩu mới. Liên kết sẽ được hệ thống xác thực kiểm tra trước khi lưu.</p>
          <div>
            <label htmlFor="recovery-password" className="field-label">Mật khẩu mới</label>
            <input id="recovery-password" type="password" autoComplete="new-password" minLength={8} required className="field-input"
              value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
          </div>
          <div>
            <label htmlFor="recovery-confirmation" className="field-label">Xác nhận mật khẩu mới</label>
            <input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={8} required className="field-input"
              value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={submitting} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "Đang cập nhật…" : "Lưu mật khẩu mới"}
          </button>
        </form>
      )}
      {state !== "complete" && <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-brand hover:underline">Quay lại đăng nhập</Link>}
    </div>
  );
}
