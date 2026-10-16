import { PrismaClient } from "@prisma/client";
import { prisma } from "./client";

export interface ServiceSeed {
  slug: string;
  name: string;
  summary: string;
  description: string;
  features: string[];
  processSteps: { title: string; description: string }[];
  sortOrder: number;
}

const STANDARD_PROCESS = [
  { title: "Tiếp nhận yêu cầu", description: "Bạn gửi yêu cầu, chúng tôi liên hệ trong 1 ngày làm việc để làm rõ phạm vi." },
  { title: "Khảo sát & báo giá", description: "Phân tích nghiệp vụ, đề xuất giải pháp, báo giá và lộ trình theo milestone." },
  { title: "Triển khai", description: "Phát triển theo từng milestone, cập nhật tiến độ trên Customer Portal." },
  { title: "Nghiệm thu & bàn giao", description: "Kiểm thử cùng bạn, bàn giao mã nguồn/tài liệu và hỗ trợ sau triển khai." },
];

export const DEFAULT_SERVICES: ServiceSeed[] = [
  {
    slug: "custom-web-app-development",
    name: "Custom Web App Development",
    summary: "Thiết kế và phát triển web app, phần mềm quản lý theo đúng quy trình doanh nghiệp.",
    description: "Xây dựng ứng dụng web theo yêu cầu: hệ thống quản lý nội bộ, cổng khách hàng, dashboard báo cáo. Kiến trúc rõ ràng, dễ mở rộng và bàn giao đầy đủ.",
    features: ["Phân tích nghiệp vụ & thiết kế UI/UX", "Phân quyền người dùng (RBAC)", "Dashboard & báo cáo", "Tích hợp thanh toán, email, API bên thứ ba"],
    processSteps: STANDARD_PROCESS,
    sortOrder: 10,
  },
  {
    slug: "ai-chatbot-development",
    name: "AI Chatbot Development",
    summary: "Chatbot AI cho website và chăm sóc khách hàng, trả lời theo dữ liệu của doanh nghiệp.",
    description: "Chatbot AI hiểu sản phẩm, chính sách và câu hỏi thường gặp của bạn; chuyển tiếp cho nhân viên khi cần và ghi nhận khách hàng tiềm năng.",
    features: ["Huấn luyện theo tài liệu doanh nghiệp", "Nhúng widget vào website", "Chuyển tiếp nhân viên (handoff)", "Thống kê hội thoại"],
    processSteps: STANDARD_PROCESS,
    sortOrder: 20,
  },
  {
    slug: "facebook-messenger-automation",
    name: "Facebook Messenger Automation",
    summary: "Tự động hóa tư vấn và chốt đơn trên Facebook Messenger, Zalo OA.",
    description: "Kịch bản trả lời tự động, thu thập thông tin khách hàng và đồng bộ về CRM, kết hợp AI để tư vấn ngoài giờ.",
    features: ["Kịch bản tư vấn tự động", "Thu thập lead về CRM", "Kết hợp AI trả lời", "Báo cáo hiệu quả"],
    processSteps: STANDARD_PROCESS,
    sortOrder: 30,
  },
  {
    slug: "custom-plugin-development",
    name: "Custom Plugin Development",
    summary: "Phát triển plugin WordPress/WooCommerce theo yêu cầu riêng.",
    description: "Plugin được viết theo chuẩn WordPress, bảo mật, có thể tích hợp hệ thống license và cập nhật tự động của PGS.",
    features: ["Chuẩn WordPress Coding Standards", "Tương thích WooCommerce", "Tích hợp license & auto-update", "Tài liệu sử dụng"],
    processSteps: STANDARD_PROCESS,
    sortOrder: 40,
  },
  {
    slug: "business-process-automation",
    name: "Business Process Automation",
    summary: "Tự động hóa quy trình vận hành với n8n và CRM automation.",
    description: "Kết nối các công cụ bạn đang dùng (Google Sheets, CRM, email, kế toán) thành quy trình tự động, giảm thao tác thủ công.",
    features: ["Workflow n8n", "CRM automation", "Thông báo & báo cáo tự động", "Giám sát và cảnh báo lỗi"],
    processSteps: STANDARD_PROCESS,
    sortOrder: 50,
  },
  {
    slug: "api-integration",
    name: "API Integration",
    summary: "Tích hợp API giữa website, phần mềm và dịch vụ bên thứ ba.",
    description: "Thiết kế và triển khai tích hợp API an toàn: thanh toán, vận chuyển, hóa đơn điện tử, CRM, ERP, có xử lý lỗi và retry.",
    features: ["REST/Webhook", "Xác thực & ký số an toàn", "Retry và idempotency", "Giám sát tích hợp"],
    processSteps: STANDARD_PROCESS,
    sortOrder: 60,
  },
];

/**
 * Create-only seed for the six launch services. Existing rows (matched by slug)
 * are never overwritten, so admin edits survive re-seeding. Services start
 * ACTIVE outside production and DRAFT in production (staff publish them).
 */
export async function seedServiceCatalog(db: PrismaClient = prisma): Promise<void> {
  const status = process.env.NODE_ENV === "production" ? "DRAFT" : "ACTIVE";
  for (const s of DEFAULT_SERVICES) {
    await db.service.upsert({
      where: { slug: s.slug },
      update: {},
      create: {
        slug: s.slug,
        name: s.name,
        summary: s.summary,
        description: s.description,
        features: s.features,
        processSteps: s.processSteps,
        pricingMode: "QUOTE_REQUIRED",
        status,
        sortOrder: s.sortOrder,
      },
    });
  }
  console.log(`[seed] Service catalog ensured (${DEFAULT_SERVICES.length} services).`);
}
