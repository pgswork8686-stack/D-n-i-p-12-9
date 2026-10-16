/**
 * Evaluates the "Send New Inquiry Notification Email" body expression the way n8n would
 * (a JS expression with `$('Webhook Trigger')` and `$env`) and checks what it produces.
 * n8n itself is not needed: the point is the escaping and JSON-safety of user-typed text.
 *
 * Usage: node automation/n8n/scripts/check-service-inquiry-template.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(fs.readFileSync(path.resolve(here, "../workflows/service-inquiry-notify-email.json"), "utf8"));
const node = wf.nodes.find((n) => n.name === "Send New Inquiry Notification Email");
assert.ok(node, "provider node exists");

const raw = node.parameters.jsonBody;
assert.ok(raw.startsWith("={{") && raw.trimEnd().endsWith("}}"), "body is a single n8n expression");
const expression = raw.slice(3, raw.trimEnd().length - 2);

function render(payload) {
  const ctx = vm.createContext({
    $: () => ({ first: () => ({ json: { body: { payload } } }) }),
    $env: { TRANSACTIONAL_FROM_EMAIL: "noreply@example.test" },
  });
  const out = vm.runInContext(expression, ctx);
  assert.equal(typeof out, "string", "expression returns a JSON string");
  return JSON.parse(out); // must always be valid JSON
}

const base = { recipientEmail: "ops@example.test", inquiryNumber: "SI-202610-ABCDEF", serviceName: "AI Chatbot", companyName: "ABC", adminUrl: "https://admin.example.test/service-inquiries/1" };

// 1. Normal case.
const ok = render(base);
assert.equal(ok.from, "noreply@example.test");
assert.equal(ok.to, "ops@example.test");
assert.equal(ok.subject, "New service inquiry SI-202610-ABCDEF");
assert.match(ok.html, /Company: ABC/);
assert.match(ok.html, /href="https:\/\/admin\.example\.test\/service-inquiries\/1"/);

// 2. Hostile free text typed by an anonymous visitor must not become markup or break the JSON.
const hostile = render({
  ...base,
  companyName: `<script>alert(1)</script>"} , "bcc": "attacker@evil.test", "x": "\n\\`,
  serviceName: `<img src=x onerror=alert(1)>`,
});
assert.ok(!hostile.html.includes("<script>"), "script tag is escaped");
assert.ok(!hostile.html.includes("<img"), "img tag is escaped");
assert.ok(hostile.html.includes("&lt;script&gt;"), "escaped form is present");
assert.equal(hostile.bcc, undefined, "no injected JSON field");
assert.equal(Object.keys(hostile).sort().join(","), "from,html,subject,to", "only the four expected fields");

// 3. The subject only ever carries the server-generated reference, stripped of anything else.
const subject = render({ ...base, inquiryNumber: "SI-1\r\nBcc: attacker@evil.test" }).subject;
assert.ok(!/[\r\n]/.test(subject), "no header injection through the subject");

// 4. A non-http admin link is never rendered as a link.
for (const adminUrl of ["javascript:alert(1)", "//evil.test", null, undefined, 'https://x.test/"><script>']) {
  const out = render({ ...base, adminUrl });
  assert.ok(!/href="javascript:/i.test(out.html), "no javascript: link");
  assert.ok(!out.html.includes("<script>"), "no raw script in link branch");
}

// 5. The payload contract: this workflow never needs contact details or requirements text.
assert.ok(!expression.includes("requirements") && !expression.includes("contactEmail") && !expression.includes("contactPhone"));

console.log("service-inquiry-notify-email template checks passed");
