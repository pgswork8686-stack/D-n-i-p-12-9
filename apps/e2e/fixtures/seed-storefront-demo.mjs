// Demo storefront data for an ISOLATED local/staging stack, created through
// the real Admin API with the dev token (the API only accepts that token when
// NODE_ENV !== "production"), so every row passes production validation.
//
// Usage:  E2E_API_URL=http://localhost:4000 node fixtures/seed-storefront-demo.mjs
// Re-running is safe: categories and products that already exist are skipped.
//
// Product images: the API has no media endpoint yet, so this script only
// WRITES the SQL for demo thumbnails to MEDIA_SQL_OUT (default
// results/demo-media.sql). Apply it by hand to a throwaway database only.
import fs from "node:fs";
import path from "node:path";

const API = process.env.E2E_API_URL || "http://localhost:4000";
const IMG = process.env.DEMO_IMG_BASE || "http://localhost:9232";
const MEDIA_SQL_OUT = process.env.MEDIA_SQL_OUT || path.join(process.cwd(), "results", "demo-media.sql");
const ALLOWED_HOSTS = ["localhost", "127.0.0.1", ...(process.env.SEED_ALLOW_HOSTS || "").split(",").filter(Boolean)];

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data with NODE_ENV=production");
if (!ALLOWED_HOSTS.includes(new URL(API).hostname)) {
  throw new Error(`Refusing to seed ${API}: host not in ${ALLOWED_HOSTS.join(", ")} (set SEED_ALLOW_HOSTS for an isolated container host)`);
}

const H = { "Content-Type": "application/json", Authorization: "Bearer dev-admin-token" };
async function call(method, p, body) {
  const res = await fetch(`${API}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const existing = await call("GET", "/admin/categories");
const flat = [];
const walk = (nodes) => nodes.forEach((c) => { flat.push(c); if (c.children) walk(c.children); });
walk(Array.isArray(existing) ? existing : existing.items || []);
// Push the generic dev-seed categories to the end of the nav.
for (const c of flat.filter((c) => ["wordpress", "design", "developer-tools"].includes(c.slug))) {
  await call("PATCH", `/admin/categories/${c.id}`, { sortOrder: 50 });
}

const cats = {};
const roots = [
  ["theme-wordpress", "Theme WordPress", "Theme cho bán hàng, doanh nghiệp, blog và portfolio."],
  ["plugins", "Plugins", "Thanh toán, SEO, tốc độ và vận hành cửa hàng."],
  ["ui-kits-figma", "UI Kits & Figma", "Hệ thống thiết kế dùng ngay cho web và mobile."],
  ["nextjs-react", "Next.js / React", "Starter và template cho đội phát triển."],
  ["web-app", "Web App", "SaaS, đặt lịch, học trực tuyến — mã nguồn hoàn chỉnh."],
  ["mobile-app", "Mobile App", "Mã nguồn Flutter & React Native cho iOS và Android."],
  ["chatbot-ai", "Chatbot AI", "Trợ lý AI tư vấn bán hàng và chăm sóc khách hàng."],
];
for (const [i, [slug, name, description]] of roots.entries()) {
  cats[slug] = flat.find((c) => c.slug === slug) || (await call("POST", "/admin/categories", { slug, name, description, sortOrder: i + 1 }));
}
const children = [["ban-hang", "Bán hàng & E-commerce"], ["doanh-nghiep", "Doanh nghiệp & Dịch vụ"], ["blog-tin-tuc", "Blog & Tạp chí"], ["portfolio", "Portfolio & Sáng tạo"]];
for (const [i, [slug, name]] of children.entries()) {
  cats[slug] = flat.find((c) => c.slug === slug) || (await call("POST", "/admin/categories", { slug, name, parentId: cats["theme-wordpress"].id, sortOrder: i + 1 }));
}

const LIC = { productType: "LICENSED_SOFTWARE", fulfillmentType: "INTERNAL_LICENSE" };
const DL = { productType: "DOWNLOADABLE_ASSET", fulfillmentType: "DIGITAL_DOWNLOAD" };
// Created oldest → newest; the API lists newest first. [slug, name, desc, VND, categories, types, image]
const products = [
  ["cskh-bot", "CSKH Bot — Fanpage & Zalo OA", "Trả lời tin nhắn Fanpage và Zalo OA từ kho câu hỏi của bạn.", 1190000, ["chatbot-ai"], LIC, "team-meeting.jpg"],
  ["foodgo", "FoodGo — App đặt món giao hàng", "Mã nguồn React Native: thực đơn, giỏ hàng, theo dõi đơn.", 1690000, ["mobile-app"], LIC, "ecommerce-phone.jpg"],
  ["bookingpro", "BookingPro — Đặt lịch & thanh toán", "Web app đặt lịch cho spa, phòng khám, studio.", 1290000, ["web-app"], LIC, "laptop-code.jpg"],
  ["nextshop-starter", "NextShop Starter — Next.js Commerce", "Starter thương mại điện tử Next.js, tối ưu SEO.", 1190000, ["nextjs-react"], LIC, "code-dark.jpg"],
  ["design-foundations", "Design System Foundations", "Biến màu, typography và auto-layout cho Figma.", 690000, ["ui-kits-figma"], DL, "figma-screen.jpg"],
  ["seo-schema-booster", "SEO Schema Booster", "Tạo dữ liệu cấu trúc cho sản phẩm và bài viết.", 450000, ["plugins"], LIC, "code-screen.jpg"],
  ["edusmile", "EduSmile — Trung tâm giáo dục", "Theme cho trung tâm đào tạo: khóa học, lịch học, đăng ký.", 990000, ["theme-wordpress", "doanh-nghiep"], LIC, "classroom.jpg"],
  ["foodhub", "FoodHub — Nhà hàng & Đặt món", "Thực đơn, đặt bàn và giao hàng tận nơi.", 850000, ["theme-wordpress", "doanh-nghiep"], LIC, "restaurant.jpg"],
  ["coinvault", "CoinVault — Ví điện tử Flutter", "Mã nguồn iOS & Android, hơn 40 màn hình giao dịch.", 1350000, ["mobile-app"], LIC, "mobile-apps.jpg"],
  ["apex-saas", "Apex SaaS — Multi-tenant Web App", "Khung SaaS nhiều tenant: đăng nhập, phân quyền, thanh toán.", 980000, ["web-app"], LIC, "laptop-analytics.jpg"],
  ["flowpos", "FlowPOS — Retail Admin Dashboard", "Hơn 120 màn quản trị bán lẻ, auto-layout đầy đủ.", 890000, ["ui-kits-figma"], DL, "dashboard.jpg"],
  ["sepay-connect-pro", "SePay Connect Pro — Cổng VietQR tự động", "Tạo mã VietQR, đối soát chuyển khoản tự động cho WooCommerce.", 650000, ["plugins"], LIC, "fintech.jpg"],
  ["hana-beauty", "Hana Beauty — Mỹ phẩm & Spa", "Bố cục sang trọng cho cửa hàng làm đẹp.", 790000, ["theme-wordpress", "ban-hang"], LIC, "cosmetics.jpg"],
  ["nexbot", "NexBot — Trợ lý bán hàng AI", "Trả lời khách 24/7 từ dữ liệu sản phẩm, gắn vào website và Fanpage.", 1490000, ["chatbot-ai"], LIC, "chatbot.png"],
  ["klinmart", "KlinMart — Siêu thị & Bán lẻ", "WooCommerce cho siêu thị, lọc sản phẩm nhanh trên mobile.", 890000, ["theme-wordpress", "ban-hang"], LIC, "shop-pay.jpg"],
  ["aura-studio", "Aura Studio — Agency & Portfolio", "Theme đa ngành cho agency, tối ưu Core Web Vitals.", 1250000, ["theme-wordpress", "portfolio"], LIC, "web-studio.jpg"],
];
const media = [];
let created = 0;
for (const [slug, name, shortDescription, price, catSlugs, types, img] of products) {
  let p;
  try {
    p = await call("POST", "/admin/products", {
      slug, name, shortDescription, description: shortDescription, ...types, status: "ACTIVE", brand: "Sản phẩm demo",
      categoryIds: catSlugs.map((s) => cats[s].id),
    });
  } catch (e) {
    if (e.status === 409 || e.status === 400) continue; // already seeded
    throw e;
  }
  const v = await call("POST", `/admin/products/${p.id}/variants`, { sku: `DEMO-${slug.toUpperCase()}`, name: "1 website", status: "ACTIVE", sortOrder: 1 });
  await call("POST", `/admin/variants/${v.id}/prices`, { currency: "VND", amount: price, isActive: true });
  media.push(`INSERT INTO product_media (id, product_id, type, url, alt_text, sort_order, updated_at) VALUES (gen_random_uuid()::text, '${p.id}', 'THUMBNAIL', '${IMG}/${img}', '${name.replace(/'/g, "''")}', 0, now());`);
  created++;
}

const posts = [
  ["Tối ưu Core Web Vitals cho WordPress headless", "laptop-analytics.jpg"],
  ["Tích hợp thanh toán VietQR tự động cho WooCommerce", "fintech.jpg"],
  ["Huấn luyện chatbot tư vấn từ dữ liệu sản phẩm", "ui-sketch.jpg"],
];
const contentCats = await call("GET", "/admin/content/categories");
const ccat = contentCats.find((c) => c.slug === "kien-thuc") || (await call("POST", "/admin/content/categories", { name: "Kiến thức", slug: "kien-thuc" }));
let published = 0;
if (created > 0) {
  for (const [title, img] of posts) {
    const post = await call("POST", "/admin/content/posts", {
      title, excerpt: title, content: `<p>${title} — bài viết mẫu cho môi trường demo.</p>`,
      status: "DRAFT", categoryId: ccat.id, featuredImageUrl: `${IMG}/${img}`, featuredImageAlt: title,
    });
    await call("POST", `/admin/content/posts/${post.id}/transition`, { targetStatus: "REVIEW" });
    await call("POST", `/admin/content/posts/${post.id}/transition`, { targetStatus: "PUBLISHED" });
    published++;
  }
}

fs.mkdirSync(path.dirname(MEDIA_SQL_OUT), { recursive: true });
fs.writeFileSync(MEDIA_SQL_OUT, media.join("\n") + "\n");
console.log(`categories: ${Object.keys(cats).length}, products created: ${created}, posts published: ${published}, media SQL: ${MEDIA_SQL_OUT}`);
