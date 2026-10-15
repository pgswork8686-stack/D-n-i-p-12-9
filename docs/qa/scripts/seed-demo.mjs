// Creates demo data for the UI verification through the real API (no direct DB writes).
import { writeFileSync } from "node:fs";

const API = process.env.API || "http://localhost:4000";
const ADMIN = "dev-admin-token";
const CUSTOMER = "dev-customer-token";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

async function call(method, path, { token, json, form, ip } = {}) {
  const headers = { "X-Forwarded-For": ip || `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) body = form;
  const res = await fetch(`${API}${path}`, { method, headers, body });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return data;
}

function inquiry(fields, files = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const file of files) f.append("files", new Blob([file.data], { type: "application/pdf" }), file.name);
  return f;
}

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${API}/v1/features`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}

const main = await call("POST", "/v1/service-inquiries", {
  token: CUSTOMER,
  form: inquiry(
    {
      serviceSlug: "custom-web-app-development",
      companyName: "Công ty TNHH Minh An",
      contactName: "Trần Minh An",
      contactEmail: "customer@nexustheme.dev",
      contactPhone: "0901234567",
      requirements: "Cần phần mềm quản lý kho cho 3 chi nhánh: nhập/xuất/tồn, phân quyền thủ kho, báo cáo cuối ngày.",
      desiredFeatures: JSON.stringify(["Quản lý nhập/xuất/tồn", "Phân quyền theo chi nhánh", "Báo cáo tồn kho", "Xuất Excel"]),
      budgetRange: "FROM_100M_TO_300M",
      timeline: "ONE_TO_THREE_MONTHS",
      submissionKey: crypto.randomUUID(),
    },
    [{ name: "Yêu cầu nghiệp vụ kho.pdf", data: PDF }],
  ),
});
const open = await call("POST", "/v1/service-inquiries", {
  token: CUSTOMER,
  form: inquiry({
    serviceSlug: "ai-chatbot-development",
    companyName: "Công ty TNHH Minh An",
    contactName: "Trần Minh An",
    contactEmail: "customer@nexustheme.dev",
    requirements: "Chatbot trả lời câu hỏi về tồn kho và đơn hàng trên website.",
    timeline: "FLEXIBLE",
  }),
});
await call("POST", "/v1/service-inquiries", {
  form: inquiry({
    serviceSlug: "facebook-messenger-automation",
    companyName: "Shop Thời Trang Lan Anh",
    contactName: "Nguyễn Lan Anh",
    contactEmail: "lananh.shop@example.com",
    requirements: "Tự động trả lời tin nhắn Facebook và chốt đơn ngoài giờ.",
    budgetRange: "UNDER_20M",
  }),
});

const mine = await call("GET", "/v1/me/service-inquiries", { token: CUSTOMER });
const mainInquiry = mine.items.find((i) => i.inquiryNumber === main.inquiryNumber);
const openInquiry = mine.items.find((i) => i.inquiryNumber === open.inquiryNumber);

await call("PATCH", `/v1/admin/service-inquiries/${mainInquiry.id}`, {
  token: ADMIN,
  json: { status: "QUALIFIED", staffNote: "Khách đã xác nhận phạm vi qua điện thoại." },
});
const project = await call("POST", `/v1/admin/service-inquiries/${mainInquiry.id}/convert`, {
  token: ADMIN,
  json: { title: "Phần mềm quản lý kho — Minh An", summary: "Web app quản lý kho cho 3 chi nhánh.", startDate: "2026-11-02", targetDate: "2027-01-15" },
});
await call("PATCH", `/v1/admin/service-projects/${project.id}`, { token: ADMIN, json: { status: "IN_PROGRESS" } });
const staff = await call("GET", "/v1/admin/service-staff", { token: ADMIN });
const lead = staff.find((s) => s.roles.includes("admin")) || staff[0];
await call("POST", `/v1/admin/service-projects/${project.id}/members`, { token: ADMIN, json: { userId: lead.id, role: "LEAD" } });

const titles = [
  ["Khảo sát & thiết kế", "2026-11-15"],
  ["Phát triển module nhập/xuất kho", "2026-12-20"],
  ["Nghiệm thu & bàn giao", "2027-01-15"],
];
let detail;
for (const [i, [title, dueDate]] of titles.entries()) {
  detail = await call("POST", `/v1/admin/service-projects/${project.id}/milestones`, { token: ADMIN, json: { title, dueDate, sortOrder: i } });
}
const [m1, m2] = detail.milestones;
await call("PATCH", `/v1/admin/service-projects/${project.id}/milestones/${m1.id}`, { token: ADMIN, json: { status: "DONE" } });
await call("PATCH", `/v1/admin/service-projects/${project.id}/milestones/${m2.id}`, { token: ADMIN, json: { status: "IN_PROGRESS" } });

await call("POST", `/v1/admin/service-projects/${project.id}/messages`, {
  token: ADMIN,
  json: { body: "Chào anh An, bản thiết kế màn hình nhập kho đã sẵn sàng, anh xem file đính kèm giúp em." },
});
await call("POST", `/v1/admin/service-projects/${project.id}/messages`, {
  token: ADMIN,
  json: { body: "Ghi chú nội bộ: ước tính 120 giờ công, chưa báo khách.", isInternalNote: true },
});
await call("POST", `/v1/me/service-projects/${project.id}/messages`, {
  token: CUSTOMER,
  json: { body: "Cảm ơn em, anh đã xem. Bổ sung giúp anh cột mã lô hàng." },
});
for (const [name, visibility] of [
  ["Thiết kế màn hình nhập kho.pdf", "CUSTOMER"],
  ["Dự toán nội bộ.pdf", "INTERNAL"],
]) {
  const f = new FormData();
  f.append("visibility", visibility);
  f.append("file", new Blob([PDF], { type: "application/pdf" }), name);
  await call("POST", `/v1/admin/service-projects/${project.id}/documents`, { token: ADMIN, form: f });
}

const out = { projectId: project.id, mainInquiryId: mainInquiry.id, openInquiryId: openInquiry.id };
writeFileSync(new URL("./demo-ids.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("DEMO_DATA_OK", JSON.stringify(out));
