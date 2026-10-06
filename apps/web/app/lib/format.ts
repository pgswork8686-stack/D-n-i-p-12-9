export const DEFAULT_CURRENCY = "VND" as const;

const VND = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * Formats integer minor units (VND = đồng, USD = cents). Kept local instead of
 * importing @nexus/utils so client bundles do not pull server-only helpers.
 */
export function money(amount: number | null | undefined, currency: string = DEFAULT_CURRENCY): string {
  if (amount === null || amount === undefined || !Number.isInteger(amount)) return "—";
  const code = currency.toUpperCase();
  if (code === "VND") return VND.format(amount);
  if (code === "USD") return USD.format(amount / 100);
  return `${amount} ${code}`;
}

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  DOWNLOADABLE_ASSET: "Tài nguyên tải về",
  LICENSED_SOFTWARE: "Phần mềm có bản quyền",
  EXTERNAL_MANAGED_LICENSE: "License quản lý hộ",
  MEMBERSHIP: "Gói thành viên",
  SUBSCRIPTION: "Thuê bao",
  SERVICE: "Dịch vụ",
};

export const FULFILLMENT_COPY: Record<string, string> = {
  DIGITAL_DOWNLOAD: "Tải file ngay trong trang quản lý sau khi thanh toán thành công.",
  INTERNAL_LICENSE: "Mã bản quyền được cấp tự động, kích hoạt theo tên miền.",
  EXTERNAL_MANAGED: "Bạn nhập tên miền sau khi mua, đội ngũ kích hoạt trong giờ làm việc.",
  MEMBERSHIP_ACCESS: "Quyền truy cập được mở ngay sau khi thanh toán.",
  MANUAL_SERVICE: "Chúng tôi sẽ liên hệ để bắt đầu triển khai dịch vụ.",
  HOSTING_PROVISIONING: "Tài khoản hosting được khởi tạo sau khi thanh toán.",
};

export const ORDER_STATUS: Record<string, { label: string; tone: "warn" | "ok" | "muted" }> = {
  PENDING_PAYMENT: { label: "Chờ thanh toán", tone: "warn" },
  PAID: { label: "Đã thanh toán", tone: "ok" },
  CANCELLED: { label: "Đã huỷ", tone: "muted" },
};

export function productTypeLabel(type?: string | null): string {
  return (type && PRODUCT_TYPE_LABELS[type]) || "Sản phẩm số";
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function licenseSummary(plan?: {
  maxActivations: number;
  isLifetime: boolean;
  durationDays?: number | null;
} | null): string | null {
  if (!plan) return null;
  const sites = plan.maxActivations === 1 ? "1 website" : `${plan.maxActivations} website`;
  if (plan.isLifetime) return `${sites} · trọn đời`;
  if (plan.durationDays) {
    const months = Math.round(plan.durationDays / 30);
    return months >= 12 && months % 12 === 0
      ? `${sites} · ${months / 12} năm cập nhật`
      : `${sites} · ${plan.durationDays} ngày`;
  }
  return sites;
}
