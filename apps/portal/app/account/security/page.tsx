"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "../../components/auth-guard";
import { PortalShell } from "../../components/portal-shell";
import { useAuth } from "../../context/auth-context";
import { getSupabaseClient } from "../../lib/supabase";
import { validatePasswordChange } from "../../lib/account-security";

export default function SecurityPage() {
  const { user, token } = useAuth();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setConfigured(Boolean(getSupabaseClient())), []);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || !token || !user?.email || configured !== true) return;
    const validationError = validatePasswordChange(current, password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error("Auth missing");
      // Reauthenticate with the current password before asking Supabase to
      // change it. A dev token or an API profile alone never authorizes this.
      const { data: signedIn, error: currentError } = await client.auth.signInWithPassword({
        email: user.email,
        password: current,
      });
      if (currentError || !signedIn.session?.access_token) {
        setError("Mật khẩu hiện tại không đúng hoặc phiên xác thực không hợp lệ.");
        return;
      }
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) {
        setError("Chưa đổi được mật khẩu. Hãy thử lại hoặc xác minh lại phiên đăng nhập theo hướng dẫn của hệ thống.");
        return;
      }
      setCurrent("");
      setPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch {
      setError("Không kết nối được dịch vụ xác thực. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <PortalShell>
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <Link href="/account" className="text-sm font-semibold text-[#0037b0] hover:underline">← Tài khoản</Link>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Bảo mật tài khoản</h1>
            <p className="mt-2 text-sm text-slate-600">Đổi mật khẩu đăng nhập với xác minh mật khẩu hiện tại qua Supabase Auth.</p>
          </div>
          <section aria-labelledby="security-password-heading" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 id="security-password-heading" className="text-lg font-bold text-slate-900">Đổi mật khẩu</h2>
            {configured === false && (
              <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Supabase Auth chưa được cấu hình; không thể đổi mật khẩu trên môi trường này.
              </p>
            )}
            {success && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-900">Mật khẩu đã được cập nhật thành công.</p>}
            <form className="mt-5 space-y-4" onSubmit={save}>
              <div>
                <label htmlFor="current-password" className="block text-sm font-semibold text-slate-800">Mật khẩu hiện tại</label>
                <input id="current-password" type="password" autoComplete="current-password" required
                  value={current} onChange={(event) => setCurrent(event.target.value)}
                  disabled={loading || configured !== true} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="new-password" className="block text-sm font-semibold text-slate-800">Mật khẩu mới</label>
                <input id="new-password" type="password" autoComplete="new-password" minLength={8} required
                  value={password} onChange={(event) => setPassword(event.target.value)}
                  disabled={loading || configured !== true} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-semibold text-slate-800">Nhập lại mật khẩu mới</label>
                <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required
                  value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                  disabled={loading || configured !== true} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              <button disabled={loading || configured !== true || !token} type="submit"
                className="inline-flex w-full justify-center rounded-xl bg-[#0037b0] px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? "Đang xác minh…" : "Cập nhật mật khẩu"}
              </button>
            </form>
            <p className="mt-4 text-xs text-slate-500">Xác thực hai bước (2FA) sẽ chỉ được bổ sung sau khi cấu hình MFA của dự án Supabase được xác nhận.</p>
          </section>
        </div>
      </PortalShell>
    </AuthGuard>
  );
}
