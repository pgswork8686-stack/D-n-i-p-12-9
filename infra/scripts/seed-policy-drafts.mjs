#!/usr/bin/env node
/**
 * Loads the DRAFT policy pages in docs/legal/policies/*.html into the CMS as PAGE records (status DRAFT).
 *
 *  - NEVER publishes. Publishing is PGS's decision after review (Admin → Nội dung → Sửa → Gửi duyệt → Xuất bản).
 *  - Idempotent: creates a missing page, refreshes a page that is still DRAFT, and SKIPS any page that has
 *    moved on (REVIEW / PUBLISHED / ARCHIVED …) so approved text is never overwritten.
 *  - Reports how many "[CẦN PGS XÁC NHẬN]" placeholders each draft still has.
 *
 * Usage: API_URL=http://localhost:4000 ADMIN_TOKEN=<bearer token of a user with content.write> \
 *        node infra/scripts/seed-policy-drafts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.API_URL || "http://localhost:4000").replace(/\/+$/, "");
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) {
  console.error("ADMIN_TOKEN is required (a bearer token of a user with content.write).");
  process.exit(1);
}

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs/legal/policies");
const PAGES = [
  ["chinh-sach-quyen-rieng-tu", "Chính sách quyền riêng tư"],
  ["dieu-khoan-su-dung", "Điều khoản sử dụng"],
  ["chinh-sach-thanh-toan", "Chính sách thanh toán"],
  ["chinh-sach-giao-nhan-san-pham-so", "Chính sách giao nhận sản phẩm số"],
  ["chinh-sach-doi-tra", "Chính sách đổi trả"],
  ["chinh-sach-hoan-tien", "Chính sách hoàn tiền"],
];

async function api(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${await res.text()}`);
  return res.json();
}

let failed = false;
for (const [slug, title] of PAGES) {
  const content = fs.readFileSync(path.join(DIR, `${slug}.html`), "utf8").trim();
  const placeholders = (content.match(/CẦN PGS/g) || []).length;
  try {
    const found = await api("GET", `/admin/content/posts?limit=100&search=${encodeURIComponent(slug)}`);
    const existing = (found.items || []).find((p) => p.slug === slug);
    if (!existing) {
      await api("POST", "/admin/content/posts", {
        title, slug, contentType: "PAGE", status: "DRAFT", content,
        excerpt: "Bản nháp chờ PGS phê duyệt.",
      });
      console.log(`created  ${slug}  (DRAFT, ${placeholders} mục cần PGS xác nhận)`);
    } else if (existing.status === "DRAFT") {
      await api("PATCH", `/admin/content/posts/${existing.id}`, { title, content });
      console.log(`updated  ${slug}  (still DRAFT, ${placeholders} mục cần PGS xác nhận)`);
    } else {
      console.log(`skipped  ${slug}  (đang ở trạng thái ${existing.status}, không ghi đè)`);
    }
  } catch (err) {
    failed = true;
    console.error(`FAILED   ${slug}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
