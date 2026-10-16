/**
 * Supabase v2 supports implicit recovery links (#type=recovery) and PKCE
 * callbacks (?code=...). Neither a plain page visit nor an error fragment
 * may be treated as a verified password recovery session.
 */
export function isRecoveryCallback(search: string, hash: string): boolean {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  if (query.has("error") || fragment.has("error")) return false;
  return (
    query.get("type") === "recovery" ||
    fragment.get("type") === "recovery" ||
    query.has("code")
  );
}

export function passwordValidationError(password: string, confirmation: string): string | null {
  if (password.length < 8) return "Mật khẩu mới cần tối thiểu 8 ký tự.";
  if (password !== confirmation) return "Hai mật khẩu chưa trùng khớp.";
  return null;
}

/** Redirects are generated from the current origin, never from a user-supplied URL. */
export function recoveryRedirectUrl(origin: string): string {
  return new URL("/reset-password", origin).toString();
}
