/**
 * Browser-side API helper. All money, prices and order state are decided by
 * the backend; the storefront only displays what the API returns.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<number, string> = {
  401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  403: "Bạn không có quyền thực hiện thao tác này.",
  404: "Không tìm thấy dữ liệu.",
  409: "Dữ liệu vừa thay đổi. Vui lòng tải lại trang.",
  429: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.",
};

async function parseError(res: Response): Promise<ApiError> {
  let message = FRIENDLY[res.status] || "Hệ thống đang bận. Vui lòng thử lại.";
  try {
    const body = await res.json();
    const raw = Array.isArray(body?.message) ? body.message[0] : body?.message;
    // Only surface backend messages for client errors (they are user-facing).
    if (raw && res.status >= 400 && res.status < 500 && res.status !== 401) {
      message = String(raw);
    }
  } catch {
    // keep friendly default
  }
  return new ApiError(res.status, message);
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}
