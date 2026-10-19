const PRODUCT_TYPE: Record<string, string> = {
  DOWNLOADABLE_ASSET: "Tài nguyên tải về",
  LICENSED_SOFTWARE: "Phần mềm có license",
  EXTERNAL_MANAGED_LICENSE: "License bên ngoài",
  MEMBERSHIP: "Gói thành viên",
  SUBSCRIPTION: "Đăng ký định kỳ",
  SERVICE: "Dịch vụ",
};
const FULFILLMENT: Record<string, string> = {
  DIGITAL_DOWNLOAD: "Tải xuống",
  INTERNAL_LICENSE: "License nội bộ",
  EXTERNAL_MANAGED: "Cấp suất bên ngoài",
  MEMBERSHIP_ACCESS: "Quyền thành viên",
  MANUAL_SERVICE: "Dịch vụ thủ công",
  HOSTING_PROVISIONING: "Cấp hosting",
};
const STATUS: Record<string, string> = { DRAFT: "Bản nháp", ACTIVE: "Đang bán", ARCHIVED: "Đã lưu trữ" };

const pick = (map: Record<string, string>, code?: string | null) => (code ? map[code] ?? code : "—");
export const productTypeLabel = (c?: string | null) => pick(PRODUCT_TYPE, c);
export const fulfillmentLabel = (c?: string | null) => pick(FULFILLMENT, c);
export const catalogStatusLabel = (c?: string | null) => pick(STATUS, c);

const BILLING: Record<string, string> = { ONE_TIME: "Một lần", RECURRING: "Định kỳ" };
export const billingTypeLabel = (c?: string | null) => pick(BILLING, c);

const JOB_STATUS: Record<string, string> = { PENDING: "Đang chờ", RUNNING: "Đang chạy", SUCCEEDED: "Thành công", FAILED: "Thất bại", CANCELLED: "Đã hủy" };
const JOB_TYPE: Record<string, string> = {
  CMS_AI_DRAFT: "Bản nháp AI cho nội dung",
  ORDER_PAID_EMAIL: "Email xác nhận thanh toán",
  LICENSE_PROVISIONED_EMAIL: "Email giao license",
};
export const jobStatusLabel = (c?: string | null) => pick(JOB_STATUS, c);
export const jobTypeLabel = (c?: string | null) => pick(JOB_TYPE, c);

const POST_STATUS: Record<string, string> = {
  IDEA: "Ý tưởng", DRAFT: "Bản nháp", AI_DRAFT: "Nháp AI", REVIEW: "Chờ duyệt",
  SCHEDULED: "Đã lên lịch", PUBLISHED: "Đã xuất bản", ARCHIVED: "Đã lưu trữ",
};
export const postStatusLabel = (c?: string | null) => pick(POST_STATUS, c);
