import { getApiUrl } from "./api";

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** Vietnamese message for a failed Admin API call. `subject` is e.g. "ticket". */
export function adminErrorMessage(status: number, subject: string): string {
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return `Tài khoản không có quyền thao tác với ${subject} (403).`;
  if (status === 404) return `Không tìm thấy ${subject}.`;
  if (status === 409) return `Dữ liệu ${subject} vừa được thay đổi ở nơi khác. Hãy tải lại.`;
  if (status === 429) return "Quá nhiều yêu cầu. Vui lòng đợi một lát rồi thử lại.";
  return `Không xử lý được yêu cầu ${subject}. Vui lòng thử lại.`;
}

/** Authenticated JSON request to the Admin API; throws AdminApiError with a Vietnamese message. */
export async function adminFetch<T>(
  path: string,
  token: string,
  subject: string,
  init: RequestInit = {},
): Promise<T> {
  // FormData must set its own multipart boundary, so only JSON bodies get a Content-Type.
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    Authorization: "Bearer " + token,
    ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const res = await fetch(getApiUrl() + path, { ...init, headers, cache: "no-store" });
  if (!res.ok) throw new AdminApiError(adminErrorMessage(res.status, subject), res.status);
  return (await res.json()) as T;
}
