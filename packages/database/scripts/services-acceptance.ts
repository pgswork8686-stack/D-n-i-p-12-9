/**
 * Services Foundation acceptance suite (HTTP level).
 *
 * Boots the built API (apps/api/dist/main.js) on a free port against the test
 * database, Redis and MinIO, then exercises the public form, customer portal
 * and admin endpoints end to end: validation, idempotency, spam controls,
 * file checks, ownership (IDOR), RBAC, transitions and audit trail.
 *
 * Requires: pnpm build, migrated + seeded database (pnpm db:seed:local),
 * Redis and S3-compatible storage — the same services CI already starts.
 */
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as net from "net";
import * as crypto from "crypto";
import { prisma } from "../src/index";

interface GateResult {
  gate: number;
  name: string;
  passed: boolean;
  error?: string;
}

const results: GateResult[] = [];
let gateNo = 0;

function gate(name: string, condition: boolean, detail?: unknown) {
  gateNo += 1;
  const n = String(gateNo).padStart(2, "0");
  if (condition) {
    results.push({ gate: gateNo, name, passed: true });
    console.log(`  [PASS] Gate ${n}: ${name}`);
  } else {
    const error = detail === undefined ? "Assertion failed" : JSON.stringify(detail).slice(0, 400);
    results.push({ gate: gateNo, name, passed: false, error });
    console.error(`  [FAIL] Gate ${n}: ${name} - ${error}`);
  }
}

const ADMIN = "dev-admin-token";
const CUSTOMER_A = "dev-customer-token";
const CUSTOMER_B = `dev-no-email:services-acceptance-${Date.now()}`;
const CONSENT_VERSION = "acceptance-1";
const NOTIFY_EMAIL = "ops-acceptance@example.com";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const EXE = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00", "latin1");

let baseUrl = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function startApi(overrides: Record<string, string> = {}): Promise<ChildProcess> {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const entry = path.resolve(__dirname, "../../../apps/api/dist/main.js");
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      FEATURE_SERVICES: "true",
      // Per-IP quota of 4 is exercised by the rate-limit gate; the per-email quota stays out of the way.
      SERVICE_INQUIRY_RATE_LIMIT_PER_IP: "4",
      SERVICE_INQUIRY_RATE_LIMIT_PER_EMAIL: "50",
      SERVICE_INQUIRY_RATE_LIMIT_WINDOW_SECONDS: "3600",
      SERVICE_CONSENT_VERSION: CONSENT_VERSION,
      PRIVACY_POLICY_URL: "https://example.com/privacy",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += d.toString()));
  child.stderr?.on("data", (d) => (output += d.toString()));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${baseUrl}/v1/features`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) break;
  }
  child.kill();
  throw new Error(`API did not start on ${baseUrl}:\n${output.slice(-3000)}`);
}

/** Every request gets its own client IP unless one is given, so per-IP limits stay out of the way. */
async function call(
  method: string,
  url: string,
  opts: { token?: string; json?: unknown; form?: FormData; ip?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "X-Forwarded-For": opts.ip || `10.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 254)}`,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const res = await fetch(`${baseUrl}${url}`, { method, headers, body });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

function inquiryForm(fields: Record<string, string>, files: { name: string; data: Buffer; type?: string }[] = []): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append("files", new Blob([f.data], { type: f.type || "application/octet-stream" }), f.name);
  return form;
}

const validFields = (over: Record<string, string> = {}) => ({
  serviceSlug: "ai-chatbot-development",
  companyName: "Công ty Acceptance",
  contactName: "Nguyễn Văn A",
  contactEmail: "acceptance@example.com",
  requirements: "Cần chatbot AI trả lời khách hàng trên website <script>alert(1)</script>",
  desiredFeatures: JSON.stringify(["Handoff nhân viên", "Thống kê"]),
  budgetRange: "FROM_20M_TO_50M",
  timeline: "ONE_TO_THREE_MONTHS",
  consentAccepted: "true",
  consentVersion: CONSENT_VERSION,
  ...over,
});

async function run() {
  console.log("================================================================================");
  console.log("   SERVICES FOUNDATION ACCEPTANCE SUITE (HTTP)");
  console.log("================================================================================\n");

  const api = await startApi();
  try {
    // ---------------------------------------------------------------- catalog
    console.log("--- Catalog ---");
    const list = await call("GET", "/v1/services");
    const slugs: string[] = Array.isArray(list.body) ? list.body.map((s: any) => s.slug) : [];
    gate("Public catalog lists the six seeded ACTIVE services", list.status === 200 && [
      "custom-web-app-development",
      "ai-chatbot-development",
      "facebook-messenger-automation",
      "custom-plugin-development",
      "business-process-automation",
      "api-integration",
    ].every((s) => slugs.includes(s)), { status: list.status, slugs });
    const detail = await call("GET", "/v1/services/ai-chatbot-development");
    gate("Service detail exposes features, process steps and QUOTE_REQUIRED pricing", detail.status === 200 && detail.body.features.length > 0 && detail.body.processSteps.length > 0 && detail.body.pricingMode === "QUOTE_REQUIRED", detail.body);
    gate("Unknown service slug returns 404", (await call("GET", "/v1/services/does-not-exist")).status === 404);

    const draftSlug = `draft-${Date.now()}`;
    const created = await call("POST", "/v1/admin/services", { token: ADMIN, json: { slug: draftSlug, name: "Draft", summary: "s", description: "d" } });
    gate("Admin creates a service (DRAFT by default)", created.status === 201 && created.body.status === "DRAFT", created);
    gate("DRAFT services are not public", (await call("GET", `/v1/services/${draftSlug}`)).status === 404);
    gate("Duplicate slug returns 409", (await call("POST", "/v1/admin/services", { token: ADMIN, json: { slug: draftSlug, name: "x", summary: "s", description: "d" } })).status === 409);
    gate("DIRECT_CHECKOUT without a product is rejected", (await call("PATCH", `/v1/admin/services/${created.body.id}`, { token: ADMIN, json: { pricingMode: "DIRECT_CHECKOUT" } })).status === 400);
    gate("Customers cannot manage the catalog (403)", (await call("POST", "/v1/admin/services", { token: CUSTOMER_A, json: { slug: "x-y", name: "x", summary: "s", description: "d" } })).status === 403);

    // -------------------------------------------------------------- inquiries
    console.log("\n--- Inquiry submission ---");
    const key = crypto.randomUUID();
    const anon = await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ submissionKey: key })) });
    gate("Anonymous visitor submits an inquiry (201)", anon.status === 201 && /^SI-\d{6}-[0-9A-F]{6}$/.test(anon.body?.inquiryNumber), anon);
    const anonRow = await prisma.serviceInquiry.findUnique({ where: { inquiryNumber: anon.body.inquiryNumber } });
    gate("Inquiry stored as NEW, unowned, sanitized, with hashed IP", !!anonRow && anonRow.status === "NEW" && anonRow.userId === null && !anonRow.requirements.includes("<script>") && !!anonRow.ipHash && anonRow.ipHash.length === 64, anonRow);
    const retry = await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ submissionKey: key })) });
    gate("Retrying with the same submissionKey returns the same inquiry", retry.status === 201 && retry.body.inquiryNumber === anon.body.inquiryNumber, retry);
    gate("Reusing a submissionKey with another email returns 409", (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ submissionKey: key, contactEmail: "other@example.com" })) })).status === 409);
    gate("Invalid email is rejected (400)", (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ contactEmail: "not-an-email" })) })).status === 400);
    gate("Budget outside the whitelist is rejected (400)", (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ budgetRange: "ONE_BILLION" })) })).status === 400);
    gate("Missing requirements are rejected (400)", (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ requirements: "" })) })).status === 400);
    gate("Inquiry for an inactive service returns 404", (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ serviceSlug: draftSlug })) })).status === 404);

    const before = await prisma.serviceInquiry.count();
    const honeypot = await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ website: "http://spam.example" })) });
    gate("Honeypot submissions look successful but are not stored", honeypot.status === 201 && (await prisma.serviceInquiry.count()) === before, honeypot);
    gate("Anonymous attachments are refused (400)", (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields(), [{ name: "brief.pdf", data: PDF }]) })).status === 400);
    gate("An invalid bearer token is rejected instead of treated as anonymous (401)", (await call("POST", "/v1/service-inquiries", { token: "garbage-token", form: inquiryForm(validFields()) })).status === 401);

    const withFile = await call("POST", "/v1/service-inquiries", {
      token: CUSTOMER_A,
      form: inquiryForm(validFields({ contactEmail: "customer@nexustheme.dev" }), [{ name: "../../Yêu cầu.pdf", data: PDF, type: "image/png" }]),
    });
    gate("Signed-in customer submits an inquiry with a PDF attachment", withFile.status === 201, withFile);
    const inqA = await prisma.serviceInquiry.findUnique({ where: { inquiryNumber: withFile.body.inquiryNumber }, include: { attachments: true } });
    const att = inqA?.attachments[0];
    gate("Attachment type is sniffed (application/pdf), name sanitized, key server-generated", !!att && att.mimeType === "application/pdf" && att.fileName === "Yêu cầu.pdf" && att.storageKey.startsWith(`services/inquiries/${inqA!.id}/`) && att.sha256.length === 64, att);
    gate("A disguised executable is rejected (400)", (await call("POST", "/v1/service-inquiries", { token: CUSTOMER_A, form: inquiryForm(validFields(), [{ name: "invoice.pdf", data: EXE, type: "application/pdf" }]) })).status === 400);

    const rlIp = `172.16.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 254)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await call("POST", "/v1/service-inquiries", { ip: rlIp, form: inquiryForm(validFields({ contactEmail: `rl${i}@example.com` })) })).status);
    }
    gate("Per-IP rate limit returns 429 after the configured quota (4/window)", statuses.slice(0, 4).every((s) => s === 201) && statuses[4] === 429, statuses);

    // -------------------------------------------------------------- ownership
    console.log("\n--- Customer ownership & authorization ---");
    gate("Customer endpoints require authentication (401)", (await call("GET", "/v1/me/service-inquiries")).status === 401);
    const mineA = await call("GET", "/v1/me/service-inquiries", { token: CUSTOMER_A });
    gate("Customer A sees their own inquiry", mineA.status === 200 && mineA.body.items.some((i: any) => i.id === inqA!.id), mineA.status);
    const mineB = await call("GET", "/v1/me/service-inquiries", { token: CUSTOMER_B });
    gate("Customer B's list does not contain A's or anonymous inquiries", mineB.status === 200 && mineB.body.items.every((i: any) => i.id !== inqA!.id && i.id !== anonRow!.id), mineB.body);
    gate("Customer B cannot read A's inquiry by id (404)", (await call("GET", `/v1/me/service-inquiries/${inqA!.id}`, { token: CUSTOMER_B })).status === 404);
    gate("Customer B cannot read A's inquiry by number (404)", (await call("GET", `/v1/me/service-inquiries/${inqA!.inquiryNumber}`, { token: CUSTOMER_B })).status === 404);
    gate("Customer B cannot get a signed URL for A's attachment (404)", (await call("GET", `/v1/me/service-inquiries/${inqA!.id}/attachments/${att!.id}/url`, { token: CUSTOMER_B })).status === 404);
    const urlA = await call("GET", `/v1/me/service-inquiries/${inqA!.id}/attachments/${att!.id}/url`, { token: CUSTOMER_A });
    gate("Customer A gets a short-lived signed URL for their attachment", urlA.status === 200 && typeof urlA.body.url === "string" && urlA.body.expiresInSeconds <= 300, urlA.body);
    gate("Customers cannot list admin inquiries (403)", (await call("GET", "/v1/admin/service-inquiries", { token: CUSTOMER_A })).status === 403);
    gate("Customers cannot convert inquiries (403)", (await call("POST", `/v1/admin/service-inquiries/${inqA!.id}/convert`, { token: CUSTOMER_A, json: {} })).status === 403);

    // -------------------------------------------------------- review / convert
    console.log("\n--- Review & conversion ---");
    gate("CONVERTED cannot be set as a plain status (400)", (await call("PATCH", `/v1/admin/service-inquiries/${inqA!.id}`, { token: ADMIN, json: { status: "CONVERTED" } })).status === 400);
    gate("Only QUALIFIED inquiries convert (400 while NEW)", (await call("POST", `/v1/admin/service-inquiries/${inqA!.id}/convert`, { token: ADMIN, json: {} })).status === 400);
    const qualify = await call("PATCH", `/v1/admin/service-inquiries/${inqA!.id}`, { token: ADMIN, json: { status: "QUALIFIED", staffNote: "Khách tiềm năng" } });
    gate("Admin qualifies the inquiry and the reviewer is recorded", qualify.status === 200 && qualify.body.status === "QUALIFIED" && !!qualify.body.reviewedById, qualify.body);
    const conv = await call("POST", `/v1/admin/service-inquiries/${inqA!.id}/convert`, { token: ADMIN, json: { title: "Chatbot cho Acceptance", startDate: "2026-11-01", targetDate: "2026-12-31" } });
    gate("Conversion creates a PLANNING project owned by the submitting customer", conv.status === 201 && conv.body.status === "PLANNING" && conv.body.customer.email === "customer@nexustheme.dev" && /^PRJ-/.test(conv.body.projectCode), conv);
    const projectId: string = conv.body.id;
    const conv2 = await call("POST", `/v1/admin/service-inquiries/${inqA!.id}/convert`, { token: ADMIN, json: {} });
    gate("Converting again is idempotent (same project)", conv2.status === 201 && conv2.body.id === projectId, conv2.body?.id);
    gate("Exactly one project exists for the inquiry", (await prisma.serviceProject.count({ where: { inquiryId: inqA!.id } })) === 1);
    gate("Inquiry is now CONVERTED", (await prisma.serviceInquiry.findUnique({ where: { id: inqA!.id } }))?.status === "CONVERTED");

    await call("PATCH", `/v1/admin/service-inquiries/${anonRow!.id}`, { token: ADMIN, json: { status: "QUALIFIED" } });
    gate("Anonymous inquiries need an explicit customer account to convert (400)", (await call("POST", `/v1/admin/service-inquiries/${anonRow!.id}/convert`, { token: ADMIN, json: {} })).status === 400);
    gate("Converting to a non-existent account is refused (400)", (await call("POST", `/v1/admin/service-inquiries/${anonRow!.id}/convert`, { token: ADMIN, json: { customerEmail: "nobody-here@example.com" } })).status === 400);

    // ---------------------------------------------------------------- projects
    console.log("\n--- Project management ---");
    gate("Invalid project transition PLANNING -> COMPLETED is rejected (400)", (await call("PATCH", `/v1/admin/service-projects/${projectId}`, { token: ADMIN, json: { status: "COMPLETED" } })).status === 400);
    const started = await call("PATCH", `/v1/admin/service-projects/${projectId}`, { token: ADMIN, json: { status: "IN_PROGRESS" } });
    gate("PLANNING -> IN_PROGRESS succeeds and records a STATUS_CHANGED event", started.status === 200 && started.body.events.some((e: any) => e.type === "STATUS_CHANGED" && e.toStatus === "IN_PROGRESS"), started.body?.events);

    const customerA = await prisma.user.findFirst({ where: { email: "customer@nexustheme.dev" } });
    gate("Customer accounts cannot be assigned as project staff (400)", (await call("POST", `/v1/admin/service-projects/${projectId}/members`, { token: ADMIN, json: { userId: customerA!.id } })).status === 400);
    const staffList = await call("GET", "/v1/admin/service-staff", { token: ADMIN });
    const staffUser = staffList.body.find((s: any) => s.roles.some((r: string) => r !== "customer"));
    const assigned = await call("POST", `/v1/admin/service-projects/${projectId}/members`, { token: ADMIN, json: { userId: staffUser.id, role: "LEAD" } });
    gate("Staff member is assigned as LEAD", assigned.status === 201 && assigned.body.members.some((m: any) => m.userId === staffUser.id && m.role === "LEAD"), assigned.body?.members);
    const ms = await call("POST", `/v1/admin/service-projects/${projectId}/milestones`, { token: ADMIN, json: { title: "Khảo sát & thiết kế", dueDate: "2026-11-15" } });
    const msId = ms.body.milestones?.[0]?.id;
    gate("Milestone is created", ms.status === 201 && !!msId, ms.body);
    const msDone = await call("PATCH", `/v1/admin/service-projects/${projectId}/milestones/${msId}`, { token: ADMIN, json: { status: "DONE" } });
    gate("Milestone marked DONE gets completedAt", msDone.status === 200 && !!msDone.body.milestones[0].completedAt, msDone.body?.milestones);

    await call("POST", `/v1/admin/service-projects/${projectId}/messages`, { token: ADMIN, json: { body: "Biên lợi nhuận nội bộ 40%", isInternalNote: true } });
    await call("POST", `/v1/admin/service-projects/${projectId}/messages`, { token: ADMIN, json: { body: "Chào anh, dự án đã bắt đầu." } });
    const internalForm = new FormData();
    internalForm.append("visibility", "INTERNAL");
    internalForm.append("file", new Blob([PDF]), "cost-breakdown.pdf");
    const internalDoc = await call("POST", `/v1/admin/service-projects/${projectId}/documents`, { token: ADMIN, form: internalForm });
    const sharedForm = new FormData();
    sharedForm.append("visibility", "CUSTOMER");
    sharedForm.append("file", new Blob([PDF]), "proposal.pdf");
    const sharedDoc = await call("POST", `/v1/admin/service-projects/${projectId}/documents`, { token: ADMIN, form: sharedForm });
    gate("Staff upload internal and shared documents", internalDoc.status === 201 && sharedDoc.status === 201, [internalDoc.status, sharedDoc.status]);
    const internalDocId = sharedDoc.body.documents.find((d: any) => d.fileName === "cost-breakdown.pdf")?.id;

    const viewA = await call("GET", `/v1/me/service-projects/${projectId}`, { token: CUSTOMER_A });
    const viewJson = JSON.stringify(viewA.body);
    gate("Customer sees the project, milestone progress and the public message", viewA.status === 200 && viewA.body.milestoneProgress.done === 1 && viewJson.includes("dự án đã bắt đầu"), viewA.status);
    gate("Customer never sees internal notes", !viewJson.includes("Biên lợi nhuận"), undefined);
    gate("Customer never sees internal documents", !viewJson.includes("cost-breakdown.pdf") && viewJson.includes("proposal.pdf"));
    gate("Customer view hides staff emails", viewA.body.members.every((m: any) => m.email === null));
    gate("Customer cannot sign a URL for an internal document (404)", (await call("GET", `/v1/me/service-projects/${projectId}/documents/${internalDocId}/url`, { token: CUSTOMER_A })).status === 404);
    gate("Customer B cannot read A's project (404)", (await call("GET", `/v1/me/service-projects/${projectId}`, { token: CUSTOMER_B })).status === 404);
    gate("Customer B cannot post to A's project (404)", (await call("POST", `/v1/me/service-projects/${projectId}/messages`, { token: CUSTOMER_B, json: { body: "hi" } })).status === 404);
    const customerMsg = await call("POST", `/v1/me/service-projects/${projectId}/messages`, { token: CUSTOMER_A, json: { body: "Cảm ơn, tôi gửi thêm tài liệu.", isInternalNote: true } });
    gate("Customer message is stored as public even if isInternalNote is sent", customerMsg.status === 201 && customerMsg.body.messages.some((m: any) => m.body.includes("Cảm ơn") && m.senderType === "CUSTOMER" && !m.isInternalNote), customerMsg.status);
    const custForm = new FormData();
    custForm.append("visibility", "INTERNAL");
    custForm.append("file", new Blob([PDF]), "brand-guide.pdf");
    const custDoc = await call("POST", `/v1/me/service-projects/${projectId}/documents`, { token: CUSTOMER_A, form: custForm });
    gate("Customer-uploaded documents are always shared (CUSTOMER visibility)", custDoc.status === 201 && custDoc.body.documents.some((d: any) => d.fileName === "brand-guide.pdf" && d.visibility === "CUSTOMER"), custDoc.status);

    await call("PATCH", `/v1/admin/service-projects/${projectId}`, { token: ADMIN, json: { status: "IN_REVIEW" } });
    const completed = await call("PATCH", `/v1/admin/service-projects/${projectId}`, { token: ADMIN, json: { status: "COMPLETED" } });
    gate("IN_REVIEW -> COMPLETED sets completedAt", completed.status === 200 && !!completed.body.completedAt, completed.body?.completedAt);
    gate("Completed projects reject further transitions (400)", (await call("PATCH", `/v1/admin/service-projects/${projectId}`, { token: ADMIN, json: { status: "IN_PROGRESS" } })).status === 400);
    gate("Customers cannot post to a completed project (400)", (await call("POST", `/v1/me/service-projects/${projectId}/messages`, { token: CUSTOMER_A, json: { body: "hi" } })).status === 400);

    // -------------------------------------------- consent + notifications (F-12)
    console.log("\n--- Consent and new-inquiry notifications (F-12) ---");
    const cfg = await call("GET", "/v1/service-inquiries/consent");
    gate("Public consent config returns the server's version and policy link", cfg.status === 200 && cfg.body.version === CONSENT_VERSION && cfg.body.privacyPolicyUrl === "https://example.com/privacy", cfg.body);

    const consentEmail = `consent-${Date.now()}@example.com`;
    const withoutConsent = (over: Record<string, string>) => {
      const f: Record<string, string> = validFields({ contactEmail: consentEmail });
      delete f.consentAccepted;
      return inquiryForm({ ...f, ...over });
    };
    const rejected = {
      missing: (await call("POST", "/v1/service-inquiries", { form: withoutConsent({}) })).status,
      falseValue: (await call("POST", "/v1/service-inquiries", { form: withoutConsent({ consentAccepted: "false" }) })).status,
      looseValue: (await call("POST", "/v1/service-inquiries", { form: withoutConsent({ consentAccepted: "1" }) })).status,
      onlyMarketing: (await call("POST", "/v1/service-inquiries", { form: withoutConsent({ consentAccepted: "false", marketingConsent: "true" }) })).status,
    };
    gate("Missing, false, loosely-truthy or marketing-only consent is rejected (400)", Object.values(rejected).every((s) => s === 400), rejected);
    const stale = await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ contactEmail: consentEmail, consentVersion: "forged-0" })) });
    gate("A forged or stale consent version is rejected (409)", stale.status === 409, stale);
    gate("Rejected consent stores nothing and writes no outbox event", (await prisma.serviceInquiry.count({ where: { contactEmail: consentEmail } })) === 0);

    const t0 = Date.now();
    const opted = await call("POST", "/v1/service-inquiries", {
      form: inquiryForm(validFields({ contactEmail: consentEmail, marketingConsent: "true", consentAt: "2000-01-01T00:00:00Z" })),
    });
    const optedRow = await prisma.serviceInquiry.findFirst({ where: { contactEmail: consentEmail } });
    gate("Consent version and timestamp are the server's; client-supplied times are ignored", opted.status === 201 && optedRow?.consentVersion === CONSENT_VERSION && !!optedRow.consentAt && optedRow.consentAt.getTime() >= t0 - 5000, optedRow);
    gate("Marketing consent is stored only when explicitly opted in, with its own timestamp", optedRow?.marketingConsent === true && !!optedRow.marketingConsentAt, optedRow);
    gate("Marketing consent defaults to false when the box is left unticked", anonRow!.consentVersion === CONSENT_VERSION && (await prisma.serviceInquiry.findUnique({ where: { id: anonRow!.id } }))?.marketingConsent === false);

    const adminView = await call("GET", `/v1/admin/service-inquiries/${anonRow!.id}`, { token: ADMIN });
    gate("Admin sees the consent evidence for an inquiry", adminView.status === 200 && adminView.body.consentVersion === CONSENT_VERSION && !!adminView.body.consentAt && adminView.body.marketingConsent === false, adminView.body);
    const ownView = await call("GET", `/v1/me/service-inquiries/${inqA!.id}`, { token: CUSTOMER_A });
    gate("Customer responses do not carry internal consent bookkeeping", ownView.status === 200 && !("consentVersion" in ownView.body) && !("marketingConsent" in ownView.body), Object.keys(ownView.body || {}));

    const pending = await prisma.outboxEvent.findFirst({ where: { eventType: "SERVICE_INQUIRY_CREATED", aggregateId: optedRow!.id } });
    gate("Storing an inquiry writes a PENDING SERVICE_INQUIRY_CREATED outbox event atomically", !!pending && pending.status === "PENDING" && pending.aggregateType === "ServiceInquiry", pending);
    const payloadText = JSON.stringify(pending?.payload ?? {});
    gate("The outbox payload carries no contact details or requirements text", !payloadText.includes(consentEmail) && !payloadText.includes("chatbot") && !payloadText.includes("Nguyễn"), payloadText);
    gate("The event is not processed inline: staff were not notified before the worker runs", (await prisma.notification.count({ where: { type: "SERVICE_INQUIRY_CREATED", metadata: { path: ["inquiryId"], equals: optedRow!.id } } })) === 0);

    // Drive the real worker code (built dist) against the same database.
    process.env.SERVICE_INQUIRY_NOTIFY_EMAILS = NOTIFY_EMAIL;
    process.env.SERVICE_INQUIRY_NOTIFY_HOURLY_EMAIL_CAP = "1000";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const workerOutbox = require(path.resolve(__dirname, "../../../apps/worker/dist/outbox-processor.js"));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const workerNotifier = require(path.resolve(__dirname, "../../../apps/worker/dist/service-inquiry-notifier.js"));
    for (let i = 0; i < 5; i++) {
      const r = await workerOutbox.processOutboxEvents({ workerId: "services-acceptance", batchSize: 50 });
      if (r.processedCount === 0) break;
    }
    const done = await prisma.outboxEvent.findFirst({ where: { eventType: "SERVICE_INQUIRY_CREATED", aggregateId: optedRow!.id } });
    gate("The worker processes the event to PROCESSED", done?.status === "PROCESSED", done);

    const adminUser = await prisma.user.findFirst({ where: { email: "admin@nexustheme.dev" } });
    const inapp = await prisma.notification.findMany({ where: { type: "SERVICE_INQUIRY_CREATED", metadata: { path: ["inquiryId"], equals: optedRow!.id } } });
    gate("Staff with inquiry access receive an in-app notification with a link to the inquiry", inapp.length >= 1 && inapp.every((n) => n.actionUrl === `/service-inquiries/${optedRow!.id}`) && (!adminUser || inapp.some((n) => n.userId === adminUser.id)), inapp.map((n) => n.userId));
    const nonStaffIds = (await prisma.user.findMany({ where: { userRoles: { none: {} } }, select: { id: true } })).map((u) => u.id);
    gate("Accounts without inquiry access are never notified", inapp.every((n) => !nonStaffIds.includes(n.userId)));
    const adminNotifs = adminUser ? await call("GET", "/v1/notifications?isRead=false&limit=50", { token: ADMIN }) : { status: 200, body: [{ type: "SERVICE_INQUIRY_CREATED" }] };
    gate("The admin sees the notice through the notifications API", adminNotifs.status === 200 && Array.isArray(adminNotifs.body) && adminNotifs.body.some((n: any) => n.type === "SERVICE_INQUIRY_CREATED"), adminNotifs.status);
    const custNotifs = await call("GET", "/v1/notifications?limit=50", { token: CUSTOMER_A });
    gate("Customers never see staff notices", custNotifs.status === 200 && !custNotifs.body.some((n: any) => n.type === "SERVICE_INQUIRY_CREATED"));

    const emailJobs = await prisma.automationJob.findMany({ where: { type: "SERVICE_INQUIRY_NOTIFY_EMAIL", sourceId: optedRow!.id } });
    gate("One email job is queued per configured mailbox, with a minimal payload", emailJobs.length === 1 && (emailJobs[0].payloadJson as any).recipientEmail === NOTIFY_EMAIL && !JSON.stringify(emailJobs[0].payloadJson).includes(consentEmail) && !("requirements" in (emailJobs[0].payloadJson as object)), emailJobs.map((j) => j.payloadJson));

    const countsBefore = [
      await prisma.notification.count({ where: { type: "SERVICE_INQUIRY_CREATED", metadata: { path: ["inquiryId"], equals: optedRow!.id } } }),
      await prisma.automationJob.count({ where: { type: "SERVICE_INQUIRY_NOTIFY_EMAIL", sourceId: optedRow!.id } }),
      await prisma.auditLog.count({ where: { action: "SERVICE_INQUIRY_NOTIFIED", entityId: optedRow!.id } }),
    ];
    await workerNotifier.processServiceInquiryCreatedEvent({ inquiryId: optedRow!.id }, "services-acceptance-replay");
    await workerNotifier.processServiceInquiryCreatedEvent({ inquiryId: optedRow!.id }, "services-acceptance-replay");
    const countsAfter = [
      await prisma.notification.count({ where: { type: "SERVICE_INQUIRY_CREATED", metadata: { path: ["inquiryId"], equals: optedRow!.id } } }),
      await prisma.automationJob.count({ where: { type: "SERVICE_INQUIRY_NOTIFY_EMAIL", sourceId: optedRow!.id } }),
      await prisma.auditLog.count({ where: { action: "SERVICE_INQUIRY_NOTIFIED", entityId: optedRow!.id } }),
    ];
    gate("Replaying the event is idempotent: no duplicate notices, email jobs or audit rows", JSON.stringify(countsBefore) === JSON.stringify(countsAfter) && countsAfter[2] === 1, { countsBefore, countsAfter });

    // Email outage must not touch the stored inquiry: the job queue is separate from the inquiry.
    gate("The inquiry survives independently of notification delivery", (await prisma.serviceInquiry.count({ where: { id: optedRow!.id } })) === 1);
    delete process.env.SERVICE_INQUIRY_NOTIFY_EMAILS;

    // ------------------------------------------------------------------- audit
    console.log("\n--- Audit trail ---");
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ entityId: inqA!.id }, { entityId: projectId }] }, select: { action: true } })).map((a) => a.action);
    gate("Audit log records submission, review, conversion and project changes", ["SERVICE_INQUIRY_SUBMITTED", "SERVICE_INQUIRY_UPDATED", "SERVICE_INQUIRY_CONVERTED", "SERVICE_PROJECT_STATUS_CHANGED", "SERVICE_PROJECT_MEMBER_ASSIGNED", "SERVICE_PROJECT_DOCUMENT_ADDED"].every((a) => actions.includes(a)), actions);
    const events = await prisma.serviceProjectEvent.findMany({ where: { projectId } });
    gate("Project history contains internal-flagged events for internal notes", events.some((e) => e.type === "MESSAGE_POSTED" && e.isInternal) && events.some((e) => e.type === "CREATED"));
    gate("Existing marketplace endpoints still respond (GET /products)", (await call("GET", "/products")).status === 200);
  } finally {
    api.kill();
  }

  // ------------------------------------------------------- feature flag OFF
  console.log("\n--- FEATURE_SERVICES=false (separate API process) ---");
  const off = await startApi({ FEATURE_SERVICES: "false" });
  try {
    const features = await call("GET", "/v1/features");
    gate("GET /v1/features reports services=false so frontends hide navigation", features.status === 200 && features.body.services === false, features.body);
    const offStatuses = {
      publicList: (await call("GET", "/v1/services")).status,
      publicLegacy: (await call("GET", "/services")).status,
      publicSubmit: (await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields()) })).status,
      customerInquiries: (await call("GET", "/v1/me/service-inquiries", { token: CUSTOMER_A })).status,
      customerProjects: (await call("GET", "/v1/me/service-projects", { token: CUSTOMER_A })).status,
      adminServices: (await call("GET", "/v1/admin/services", { token: ADMIN })).status,
      adminInquiries: (await call("GET", "/v1/admin/service-inquiries", { token: ADMIN })).status,
      adminProjects: (await call("GET", "/v1/admin/service-projects", { token: ADMIN })).status,
      adminStaff: (await call("GET", "/v1/admin/service-staff", { token: ADMIN })).status,
    };
    gate("Every services route (public, customer, admin) returns 404 while the flag is off", Object.values(offStatuses).every((s) => s === 404), offStatuses);
    gate("Marketplace keeps working with the flag off (GET /products)", (await call("GET", "/products")).status === 200);
  } finally {
    off.kill();
  }

  // ------------------------------------------------------- Redis unavailable
  console.log("\n--- Redis unreachable (separate API process) ---");
  const noRedis = await startApi({ REDIS_URL: "redis://127.0.0.1:1" });
  try {
    const blocked = await call("POST", "/v1/service-inquiries", { form: inquiryForm(validFields({ contactEmail: "redis-down@example.com" })) });
    gate("Public submissions fail closed with 503 when the rate limiter is unavailable", blocked.status === 503, blocked);
    gate("No inquiry is stored when the limiter is unavailable", (await prisma.serviceInquiry.count({ where: { contactEmail: "redis-down@example.com" } })) === 0);
    gate("Catalog reads do not depend on Redis", (await call("GET", "/v1/services")).status === 200);
  } finally {
    noRedis.kill();
  }

  // ------------------------------------- production without a privacy policy
  console.log("\n--- Production start-up without a consent policy (separate API process) ---");
  const bootOutput = await new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, "../../../apps/api/dist/main.js")], {
      env: {
        ...process.env,
        PORT: String(20000 + crypto.randomInt(0, 10000)),
        NODE_ENV: "production",
        FEATURE_SERVICES: "true",
        SERVICE_INQUIRY_IP_SALT: "x".repeat(32),
        SERVICE_CONSENT_VERSION: "",
        PRIVACY_POLICY_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));
    const timer = setTimeout(() => child.kill(), 45000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
  gate(
    "API refuses to start in production with FEATURE_SERVICES on and no consent version / privacy-policy URL",
    bootOutput.code !== 0 && /SERVICE_CONSENT_VERSION and PRIVACY_POLICY_URL are required/.test(bootOutput.output),
    { code: bootOutput.code, tail: bootOutput.output.slice(-600) },
  );

  const failed = results.filter((r) => !r.passed);
  console.log("\n================================================================================");
  console.log(`   RESULT: ${results.length - failed.length}/${results.length} gates passed`);
  console.log("================================================================================");
  await prisma.$disconnect();
  if (failed.length > 0) process.exit(1);
}

run().catch(async (err) => {
  console.error("Services acceptance suite crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
