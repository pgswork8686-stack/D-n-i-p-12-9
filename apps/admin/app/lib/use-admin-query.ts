"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/auth-context";
import { AdminApiError, adminFetch } from "./admin-http";

export interface AdminQueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  signedIn: boolean;
  reload: () => void;
}

/**
 * GET an Admin API path with the session token. `path === null` skips the request.
 * `parse` must validate the payload and throw on a malformed response.
 */
export function useAdminQuery<T>(
  path: string | null,
  subject: string,
  parse: (json: unknown) => T,
): AdminQueryState<T> {
  const { token, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setData(null);
      setError(`Vui lòng đăng nhập bằng tài khoản được cấp quyền xem ${subject}.`);
      setLoading(false);
      return;
    }
    if (path === null) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    adminFetch<unknown>(path, token, subject)
      .then(json => { if (live) setData(parse(json)); })
      .catch(cause => {
        if (!live) return;
        setData(null);
        setError(cause instanceof AdminApiError ? cause.message : `Không tải được ${subject}.`);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // parse is a stable module-level function at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authLoading, path, subject, tick]);

  const reload = useCallback(() => setTick(x => x + 1), []);
  return { data, loading: authLoading || loading, error, signedIn: Boolean(token), reload };
}
