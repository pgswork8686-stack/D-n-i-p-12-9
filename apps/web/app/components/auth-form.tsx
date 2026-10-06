"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { isDevAuthEnabled } from "../lib/supabase";

/** Only same-site relative paths are honoured as post-login redirects. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { loginWithPassword, register, loginWithDevToken, isConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const [devToken, setDevToken] = useState("dev-user-token");

  const isLogin = mode === "login";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isLogin && password.length < 8) {
      setError("Mật khẩu cần tối thiểu 8 ký tự.");
      return;
    }
    setSubmitting(true);
    try {
      if (isLogin) {
        const err = await loginWithPassword(email.trim(), password);
        if (err) setError(err);
        else router.replace(next);
      } else {
        const res = await register(email.trim(), password);
        if (res.error) setError(res.error);
        else if (res.needsConfirmation) setConfirmSent(true);
        else router.replace(next);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmSent) {
    return (
      <div className="card p-8 text-center">
        <MailCheck aria-hidden className="mx-auto h-12 w-12 text-cta" />
        <h1 className="mt-4 text-2xl font-bold text-ink">Kiểm tra email của bạn</h1>
        <p className="mt-3 text-muted">
          Chúng tôi đã gửi liên kết xác nhận tới <span className="font-medium text-ink">{email}</span>. Mở liên kết rồi đăng nhập
          để tiếp tục.
        </p>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-primary mt-6">
          Tới trang đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{isLogin ? "Đăng nhập" : "Tạo tài khoản"}</h1>
      <p className="mt-2 text-muted">
        {isLogin ? "Đăng nhập để mua hàng và quản lý license." : "Dùng email này để nhận hoá đơn và mã bản quyền."}
      </p>

      {!isConfigured && (
        <p role="alert" className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Hệ thống đăng nhập đang bảo trì. Vui lòng quay lại sau.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
            disabled={!isConfigured}
          />
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Mật khẩu
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? undefined : 8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input pr-12"
              aria-describedby={isLogin ? undefined : "password-hint"}
              disabled={!isConfigured}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink"
            >
              {showPassword ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
            </button>
          </div>
          {!isLogin && (
            <p id="password-hint" className="mt-1.5 text-sm text-muted">
              Tối thiểu 8 ký tự.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting || !isConfigured} className="btn-primary w-full text-base">
          {submitting && <Loader2 aria-hidden className="h-5 w-5 animate-spin" />}
          {isLogin ? "Đăng nhập" : "Tạo tài khoản"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {isLogin ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
        <Link
          href={`/${isLogin ? "register" : "login"}?next=${encodeURIComponent(next)}`}
          className="font-semibold text-brand hover:underline"
        >
          {isLogin ? "Đăng ký" : "Đăng nhập"}
        </Link>
      </p>

      {isLogin && isDevAuthEnabled() && (
        <div className="mt-8 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Dev login (chỉ môi trường phát triển)</p>
          <div className="mt-3 flex gap-2">
            <label htmlFor="dev-token" className="sr-only">
              Dev token
            </label>
            <input id="dev-token" value={devToken} onChange={(e) => setDevToken(e.target.value)} className="field-input" />
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                const err = await loginWithDevToken(devToken);
                if (err) setError(err);
                else router.replace(next);
              }}
            >
              Vào
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
