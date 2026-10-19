#!/usr/bin/env node
/**
 * LIVE notification flow (no mocks between our own components):
 *
 *   paid order -> API outbox -> worker -> signed dispatch -> REAL n8n container -> email provider (mock sink)
 *                                              \-> signed callback -> REAL API -> automation job SUCCEEDED
 *
 * Only the external email provider is replaced by a local sink (so no real email is ever sent). Proves:
 *  - the worker dispatches ORDER_PAID_EMAIL and LICENSE_PROVISIONED_EMAIL to n8n with valid HMAC signatures
 *  - n8n delivers to the provider exactly once per email, to the customer, with an idempotency key
 *  - the license email carries a MASKED key and never the plaintext key
 *  - n8n's signed callback is accepted by the real API and the jobs end SUCCEEDED (not FAILED/stuck)
 *
 * Prerequisites (this script starts n8n, its replay-guard Redis and the sink itself):
 *  - API running with ENABLE_TEST_PAYMENT_PROVIDER=true, TEST_PAYMENT_WEBHOOK_SECRET and AUTOMATION_SERVICE_SECRET
 *  - worker running with the SAME AUTOMATION_SERVICE_SECRET and N8N_WEBHOOK_BASE_URL=http://localhost:5678
 *  - Docker, images n8nio/n8n:2.40.0 and redis:7-alpine
 *
 * Replay-guard Redis isolation (see replay-redis.mjs): by default the script starts its OWN Redis on its OWN Docker
 * network (no host port) and never falls back to a host Redis such as :6379. N8N_REPLAY_REDIS_HOST/PORT select another
 * Redis only if it is marked as a NexusTheme test Redis. Cleanup removes only resources labelled
 * com.nexustheme.test=n8n-live (never a global prune).
 *
 * Env: API_URL (http://localhost:4000), N8N_LIVE_SECRET (AUTOMATION_SERVICE_SECRET value), N8N_LIVE_PRODUCT_SLUG (klinmart),
 *      TEST_PAYMENT_WEBHOOK_SECRET, N8N_SMOKE_IMAGE, N8N_LIVE_PORT (5678), N8N_LIVE_SINK_PORT (4567),
 *      N8N_REPLAY_REDIS_HOST / N8N_REPLAY_REDIS_PORT / N8N_REPLAY_REDIS_PASSWORD (optional), N8N_TEST_REDIS_IMAGE (redis:7-alpine)
 */
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedN8nEnv } from "./replay-redis.mjs";

// Repo-relative paths below (workflows, the temporary credential directory) must not depend on the caller's cwd.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

const API = (process.env.API_URL || "http://localhost:4000").replace(/\/+$/, "");
const IMAGE = process.env.N8N_SMOKE_IMAGE || "n8nio/n8n:2.40.0";
const N8N_PORT = Number(process.env.N8N_LIVE_PORT || 5678);
const SINK_PORT = Number(process.env.N8N_LIVE_SINK_PORT || 4567);
const SECRET = process.env.N8N_LIVE_SECRET || "test-automation-secret-minimum-32-chars-long";
const WEBHOOK_SECRET = process.env.TEST_PAYMENT_WEBHOOK_SECRET || "ci-test-payment-secret";
const SLUG = process.env.N8N_LIVE_PRODUCT_SLUG || "klinmart";
const NAME = "nexus-n8n-live";
const VOLUME = "nexus-n8n-live-data";
const HOST = "host.docker.internal";
const CUSTOMER = "dev-customer-token";
const ADMIN = "dev-admin-token";
const CRED = {
  resend: { id: "nexustheme-resend", name: "NEXUSTHEME Resend (Header Auth: Authorization = Bearer <key>)" },
  openai: { id: "nexustheme-openai", name: "NEXUSTHEME OpenAI" },
};

const emails = [];
let sink;
const results = [];
const check = (ok, label, extra = "") => {
  results.push({ ok, label });
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${extra ? " — " + extra : ""}`);
  if (!ok) throw new Error("Check failed: " + label);
};

function docker(args, { tolerate = false, timeout = 300000 } = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout });
  if (r.status !== 0 && !tolerate) throw new Error(`docker ${args.join(" ")} failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  return r;
}

async function api(route, token, init = {}) {
  const res = await fetch(API + route, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${route} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for: " + label);
    await sleep(1000);
  }
}

function startSink() {
  return new Promise((resolve) => {
    sink = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (req.method === "POST" && req.url.startsWith("/emails")) {
          let body = {};
          try { body = JSON.parse(raw); } catch {}
          emails.push({ idempotencyKey: req.headers["idempotency-key"] || null, body, raw });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ id: "re_live_" + emails.length }));
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    });
    sink.listen(SINK_PORT, "0.0.0.0", resolve);
  });
}

const testEnv = isolatedN8nEnv({ prefix: NAME, owner: "n8n-live", n8nName: NAME, volume: VOLUME, report: check });

async function startN8n() {
  await testEnv.prepare();
  // n8n calls the API and the sink from inside the test network; prove both are reachable before buying anything.
  const apiFromN8n = `http://${HOST}:${new URL(API).port || 4000}`;
  check(testEnv.reachableFromNetwork(apiFromN8n, IMAGE), "the real API is reachable from the test network", apiFromN8n);
  check(testEnv.reachableFromNetwork(`http://${HOST}:${SINK_PORT}/`, IMAGE), "the email sink is reachable from the test network");
  docker(["run", "-d", "--name", NAME, ...testEnv.runArgs, "--entrypoint", "/bin/sh",
    "-e", "NODE_FUNCTION_ALLOW_BUILTIN=crypto,net", "-e", "N8N_BLOCK_ENV_ACCESS_IN_NODE=false", IMAGE, "-c", "sleep 600"]);
  docker(["cp", "automation/n8n/workflows", `${NAME}:/files/`]);
  // Synthetic credentials only; the directory is git-ignored and removed even when an import fails.
  const credDir = "automation/n8n/scripts/.live-cred";
  try {
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(path.join(credDir, "resend.json"), JSON.stringify([{ id: CRED.resend.id, name: CRED.resend.name, type: "httpHeaderAuth", data: { name: "Authorization", value: "Bearer re-live-not-a-real-key" } }]));
    fs.writeFileSync(path.join(credDir, "openai.json"), JSON.stringify([{ id: CRED.openai.id, name: CRED.openai.name, type: "openAiApi", data: { apiKey: "sk-live-not-a-real-key" } }]));
    docker(["cp", credDir, `${NAME}:/files/`]);
    for (const f of ["resend.json", "openai.json"]) docker(["exec", NAME, "n8n", "import:credentials", `--input=/files/.live-cred/${f}`]);
  } finally {
    fs.rmSync(credDir, { recursive: true, force: true });
  }
  for (const f of ["cms-ai-draft", "order-paid-email", "license-provisioned-email"]) docker(["exec", NAME, "n8n", "import:workflow", `--input=/files/${f}.json`]);
  for (const id of ["nexustheme-cms-ai-draft", "nexustheme-order-paid-email", "nexustheme-license-provisioned-email"]) docker(["exec", NAME, "n8n", "publish:workflow", `--id=${id}`]);
  docker(["rm", "-f", NAME]);

  docker(["run", "-d", "--name", NAME, ...testEnv.runArgs, "-p", `${N8N_PORT}:5678`,
    "-e", "NODE_FUNCTION_ALLOW_BUILTIN=crypto,net", "-e", "N8N_BLOCK_ENV_ACCESS_IN_NODE=false", ...testEnv.replayEnv,
    "-e", `AUTOMATION_SERVICE_SECRET=${SECRET}`,
    // The REAL API receives n8n's signed callbacks; only the email provider is the local sink.
    "-e", `NEXUS_API_BASE_URL=${apiFromN8n}`,
    "-e", `RESEND_API_BASE_URL=http://${HOST}:${SINK_PORT}`, "-e", `OPENAI_API_BASE_URL=http://${HOST}:${SINK_PORT}`,
    "-e", "TRANSACTIONAL_FROM_EMAIL=orders@nexustheme.test", "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SECURE_COOKIE=false", IMAGE]);
  await until(async () => { try { return (await fetch(`http://localhost:${N8N_PORT}/healthz`)).ok; } catch { return false; } }, 120000, "n8n health");
  // Webhooks register shortly after /healthz; an unsigned probe answering 200 proves the route exists.
  await until(async () => {
    try { return (await fetch(`http://localhost:${N8N_PORT}/webhook/order-paid-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 200; } catch { return false; }
  }, 120000, "n8n webhook registration");
  check(emails.length === 0, "n8n booted with the workflows; an unsigned probe sent no email");
}

async function main() {
  console.log("=== LIVE notification flow (worker -> n8n -> email sink, callbacks into the real API) ===");
  await startSink();
  try {
    await startN8n();

    const before = Date.now();
    const product = await api(`/products/${SLUG}`, CUSTOMER);
    const variant = product.variants.find((v) => v.prices?.some((p) => p.currency === "VND")) || product.variants[0];
    await api("/cart", CUSTOMER, { method: "DELETE" }).catch(() => undefined);
    await api("/cart/items", CUSTOMER, { method: "POST", body: JSON.stringify({ variantId: variant.id, quantity: 1, currency: "VND" }) });
    const checkout = await api("/checkout", CUSTOMER, { method: "POST", body: JSON.stringify({ currency: "VND", idempotencyKey: "live-" + before }) });
    const orderId = checkout.order.id;
    const session = await api(`/orders/${orderId}/payment-session`, CUSTOMER, { method: "POST", body: JSON.stringify({ provider: "test" }) });
    const eventId = "evt_live_" + before;
    const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${eventId}:${session.paymentId}:payment.succeeded`).digest("hex");
    const cb = await fetch(`${API}/payments/test-callback`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-signature": sig },
      body: JSON.stringify({ paymentId: session.paymentId, externalEventId: eventId, eventType: "payment.succeeded" }),
    });
    check(cb.ok, "order paid through a signed payment callback", `order ${orderId}`);

    const me = await api("/auth/me", CUSTOMER);

    // The shared dev database may hold an old backlog of jobs that the worker also delivers; everything below is
    // therefore tied to THIS order's own jobs and idempotency keys, never to global counts.
    const listJobs = async () => (await api("/admin/automation/jobs?limit=100", ADMIN)).items || [];
    const orderJob = await until(async () => (await listJobs()).find((j) => j.type === "ORDER_PAID_EMAIL" && j.sourceId === orderId), 90000,
      "the ORDER_PAID_EMAIL job for this order (is the worker running?)");
    check(Boolean(orderJob.payloadJson?.providerIdempotencyKey), "the outbox created an ORDER_PAID_EMAIL job with a provider idempotency key", orderJob.id);
    const licenseJob = await until(async () => (await listJobs()).find((j) => j.type === "LICENSE_PROVISIONED_EMAIL" && new Date(j.createdAt).getTime() >= before - 5000
      && j.payloadJson?.recipientEmail === me.email), 90000, "the LICENSE_PROVISIONED_EMAIL job created by this purchase");
    check(Boolean(licenseJob.payloadJson?.maskedKey), "the license job carries only a masked key", licenseJob.payloadJson?.maskedKey);

    const mailFor = (job) => emails.filter((e) => e.idempotencyKey === job.payloadJson.providerIdempotencyKey);
    await until(() => mailFor(orderJob).length >= 1 && mailFor(licenseJob).length >= 1, 120000, "both emails at the provider sink");
    await sleep(3000); // give a duplicate delivery the chance to show up
    check(mailFor(orderJob).length === 1, "the order email reached the provider exactly once");
    check(mailFor(licenseJob).length === 1, "the license email reached the provider exactly once");
    const orderMail = mailFor(orderJob)[0];
    const licenseMail = mailFor(licenseJob)[0];
    check([orderMail, licenseMail].every((m) => JSON.stringify(m.body.to ?? "").includes(me.email)), "both emails were addressed to the customer", me.email);

    const content = String(licenseMail.body.html || licenseMail.body.text || "");
    check(content.includes("****"), "the license email shows a MASKED key");
    // Compare against the REAL key (revealed through the customer API) rather than guessing its format.
    const licenses = await api("/licenses", CUSTOMER);
    const match = licenses.find((l) => String(l.keyMasked) === String(licenseJob.payloadJson.maskedKey)) || [...licenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const revealed = await fetch(`${API}/licenses/${match.id}/reveal`, { method: "POST", headers: { Authorization: `Bearer ${CUSTOMER}` } });
    check(revealed.ok, "fetched the real license key to compare against");
    const plaintext = (await revealed.json()).licenseKey;
    check(typeof plaintext === "string" && plaintext.length >= 12, "the real key is a non-trivial string");
    check(!licenseMail.raw.includes(plaintext) && !orderMail.raw.includes(plaintext), "neither email contains the plaintext license key");

    const final = await until(async () => {
      const jobs = (await listJobs()).filter((j) => j.id === orderJob.id || j.id === licenseJob.id);
      return jobs.length === 2 && jobs.every((j) => ["SUCCEEDED", "FAILED"].includes(j.status)) ? jobs : null;
    }, 120000, "both jobs to reach a final state");
    check(final.every((j) => j.status === "SUCCEEDED"), "n8n's signed callbacks were accepted by the real API: both jobs are SUCCEEDED", final.map((j) => `${j.type}:${j.status}`).join(", "));
    console.log(`\n=== LIVE NOTIFICATION FLOW: ${results.length}/${results.length} CHECKS PASSED ===`);
  } finally {
    testEnv.cleanup();
    sink?.close();
  }
}

main().catch((err) => {
  console.error("LIVE FLOW FAILED:", err.message);
  process.exit(1);
});
