#!/usr/bin/env node

/**
 * NEXUSTHEME Phase 12 — REAL n8n runtime smoke (pinned n8nio/n8n:2.40.0).
 *
 * Proves in a REAL n8n container:
 *  1. n8n boots (health)
 *  2. workflows + credentials import
 *  3. Code nodes execute: require('crypto') + require('net') + $env access
 *  4. valid signed dispatch → deterministic mock provider reached EXACTLY once,
 *     with the authoritative Idempotency-Key
 *  5. replayed requestId → provider receives ZERO additional calls
 *  6. invalid HMAC / wrong service → provider receives ZERO calls
 *  7. signed n8n→Nexus callback shape (HMAC verified by the mock)
 *
 * No real OpenAI / Resend network calls. Mock providers only.
 */
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const N8N_IMAGE = process.env.N8N_SMOKE_IMAGE || "n8nio/n8n:2.40.0";
const N8N_PORT = Number(process.env.N8N_SMOKE_PORT || 5678);
const MOCK_PORT = Number(process.env.N8N_SMOKE_MOCK_PORT || 4567);
const N8N_NAME = "nexus-n8n-smoke";
const SECRET = process.env.N8N_SMOKE_SECRET || "smoke-automation-secret-min-32-chars";
const REDIS_HOST = process.env.N8N_SMOKE_REDIS_HOST || "host.docker.internal";
const REDIS_PORT = Number(process.env.N8N_SMOKE_REDIS_PORT || 6379);
const HOST_TARGET = process.platform === "win32" ? "host.docker.internal" : "host.docker.internal";

// Must match the credential REFERENCES committed in the workflow JSON
// (automation/n8n/scripts/build-workflows.mjs). Values are never committed.
const NEXUS_CREDENTIAL_IDS = { resend: "nexustheme-resend", openai: "nexustheme-openai" };
const NEXUS_CREDENTIAL_NAMES = {
  resend: "NEXUSTHEME Resend (Header Auth: Authorization = Bearer <key>)",
  openai: "NEXUSTHEME OpenAI",
};

const counts = {
  resend: [],
  openai: [],
  nexusComplete: [],
  nexusFail: [],
};

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function sign(service, method, p, timestamp, requestId, rawBody) {
  const bodyHash = sha256Hex(rawBody);
  const canonical = [service, method, p, timestamp, requestId, bodyHash].join("\n");
  return crypto.createHmac("sha256", SECRET).update(canonical).digest("hex");
}

let mockServer;
function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const record = { path: req.url, idempotencyKey: req.headers["idempotency-key"] || null, auth: req.headers.authorization || null, body: raw };
        if (req.url.startsWith("/emails")) {
          counts.resend.push(record);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ id: "re_mock_" + counts.resend.length }));
        } else if (req.url.startsWith("/v1/chat/completions")) {
          counts.openai.push(record);
          const article = { title: "Smoke Article", excerpt: "Excerpt", content: "<p>Content</p>", seoTitle: "SEO", seoDescription: "SEO desc", suggestedSlug: "smoke-article" };
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(article) } }] }));
        } else if (req.url.startsWith("/v1/internal/automation/jobs/") && req.url.endsWith("/complete")) {
          // Verify HMAC shape of n8n -> Nexus callback
          const h = req.headers;
          const sigOk = (() => {
            if (!h["x-nexus-signature"] || !h["x-nexus-timestamp"] || !h["x-nexus-request-id"]) return false;
            const expected = sign("n8n", "POST", req.url, h["x-nexus-timestamp"], h["x-nexus-request-id"], raw);
            const a = Buffer.from(h["x-nexus-signature"], "hex");
            const b = Buffer.from(expected, "hex");
            return a.length === b.length && crypto.timingSafeEqual(a, b);
          })();
          counts.nexusComplete.push({ path: req.url, sigOk, service: h["x-nexus-service"] });
          res.statusCode = sigOk ? 200 : 401;
          res.end(JSON.stringify({ sigOk }));
        } else if (req.url.startsWith("/v1/internal/automation/jobs/") && req.url.endsWith("/fail")) {
          counts.nexusFail.push({ path: req.url, body: raw });
          res.statusCode = 200;
          res.end("{}");
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    });
    mockServer.listen(MOCK_PORT, () => resolve());
  });
}

function docker(args, opts = {}) {
  // shell:false — args are passed verbatim. With shell:true on Windows the
  // args get joined unquoted, which corrupts container commands such as
  // `-c "sleep 600"`.
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: opts.timeout || 180000, shell: false });
  if (r.status !== 0 && !opts.tolerateFailure) {
    throw new Error(`docker ${args.join(" ")} failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  }
  return r;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  return res;
}

async function waitN8nHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetchWithTimeout(`http://localhost:${N8N_PORT}/healthz`, {}, 3000);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function signedDispatchHeaders(bodyObj, requestId, opts = {}) {
  const raw = JSON.stringify(bodyObj);
  const timestamp = Date.now().toString();
  const path = opts.path;
  const service = opts.service || "worker";
  const signature = opts.badSignature
    ? "f".repeat(64)
    : sign(service, "POST", path, timestamp, requestId, raw);
  return {
    "Content-Type": "application/json",
    "X-Nexus-Service": service,
    "X-Nexus-Timestamp": timestamp,
    "X-Nexus-Request-Id": requestId,
    "X-Nexus-Signature": signature,
    "X-Nexus-Signature-Version": "v1",
  };
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for: " + label);
}

async function main() {
  console.log(`=== NEXUSTHEME n8n RUNTIME SMOKE (image: ${N8N_IMAGE}) ===`);
  let exitCode = 0;
  await startMockServer();
  console.log(`Mock provider server listening on :${MOCK_PORT}`);

  docker(["rm", "-f", N8N_NAME], { tolerateFailure: true });
  docker(["volume", "rm", "nexus-n8n-smoke-data"], { tolerateFailure: true });

  // Phase A: idle container (server NOT running) — import workflows + credentials.
  // Running CLI imports while the n8n server is up races the SQLite migrations.
  docker([
    "run", "-d", "--name", N8N_NAME,
    "--entrypoint", "/bin/sh",
    "--add-host", "host.docker.internal:host-gateway",
    "-v", "nexus-n8n-smoke-data:/home/node/.n8n",
    "-e", `NODE_FUNCTION_ALLOW_BUILTIN=crypto,net`,
    "-e", `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`,
    "-e", `N8N_REPLAY_REDIS_HOST=${REDIS_HOST}`,
    "-e", `N8N_REPLAY_REDIS_PORT=${REDIS_PORT}`,
    "-e", `AUTOMATION_SERVICE_SECRET=${SECRET}`,
    N8N_IMAGE,
    "-c", "sleep 600",
  ], { timeout: 300000 });
  console.log("n8n container started (idle import phase)");

  try {
    docker(["cp", "automation/n8n/workflows", `${N8N_NAME}:/files/`]);
    // Write credential reference files on the host, then copy them in
    // (avoids fragile inline shell quoting inside the container).
    const credDir = "automation/n8n/scripts/.smoke-cred";
    fs.mkdirSync(credDir, { recursive: true });
    // n8n `import:credentials` requires an ARRAY of credential objects with an id.
    // Values here are obviously-fake placeholders — never real provider keys.
    // Ids/names match the credential references committed in the workflow JSON.
    fs.writeFileSync(
      path.join(credDir, "resend-cred.json"),
      JSON.stringify([
        {
          id: NEXUS_CREDENTIAL_IDS.resend,
          name: NEXUS_CREDENTIAL_NAMES.resend,
          type: "httpHeaderAuth",
          data: { name: "Authorization", value: "Bearer re-smoke-not-a-real-key" },
        },
      ]) + "\n",
    );
    fs.writeFileSync(
      path.join(credDir, "openai-cred.json"),
      JSON.stringify([
        {
          id: NEXUS_CREDENTIAL_IDS.openai,
          name: NEXUS_CREDENTIAL_NAMES.openai,
          type: "openAiApi",
          data: { apiKey: "sk-smoke-not-a-real-key" },
        },
      ]) + "\n",
    );
    docker(["cp", credDir, `${N8N_NAME}:/files/`]);
    for (const f of ["resend-cred.json", "openai-cred.json"]) {
      docker(["exec", N8N_NAME, "n8n", "import:credentials", `--input=/files/.smoke-cred/${f}`]);
    }
    for (const f of ["cms-ai-draft.json", "order-paid-email.json", "license-provisioned-email.json"]) {
      docker(["exec", N8N_NAME, "n8n", "import:workflow", `--input=/files/${f}`]);
    }
    // n8n 2.x: `update:workflow --all --active=true` is deprecated/removed.
    // Workflows are published individually by their stable id.
    for (const id of ["nexustheme-cms-ai-draft", "nexustheme-order-paid-email", "nexustheme-license-provisioned-email"]) {
      docker(["exec", N8N_NAME, "n8n", "publish:workflow", `--id=${id}`]);
    }
    console.log("PASS: workflow + credential import (n8n CLI)");

    docker(["rm", "-f", N8N_NAME]);

    // Phase B: real n8n server on the imported data volume.
    docker([
      "run", "-d", "--name", N8N_NAME,
      "--add-host", "host.docker.internal:host-gateway",
      "-v", "nexus-n8n-smoke-data:/home/node/.n8n",
      "-p", `${N8N_PORT}:5678`,
      "-e", `NODE_FUNCTION_ALLOW_BUILTIN=crypto,net`,
      "-e", `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`,
      "-e", `N8N_REPLAY_REDIS_HOST=${REDIS_HOST}`,
      "-e", `N8N_REPLAY_REDIS_PORT=${REDIS_PORT}`,
      "-e", `AUTOMATION_SERVICE_SECRET=${SECRET}`,
      "-e", `NEXUS_API_BASE_URL=http://${HOST_TARGET}:${MOCK_PORT}`,
      "-e", `RESEND_API_BASE_URL=http://${HOST_TARGET}:${MOCK_PORT}`,
      "-e", `OPENAI_API_BASE_URL=http://${HOST_TARGET}:${MOCK_PORT}`,
      "-e", `TRANSACTIONAL_FROM_EMAIL=smoke@nexustheme.test`,
      "-e", `N8N_DIAGNOSTICS_ENABLED=false`,
      "-e", `N8N_SECURE_COOKIE=false`,
      N8N_IMAGE,
    ], { timeout: 300000 });
    console.log("n8n server phase started");

    if (!(await waitN8nHealthy())) throw new Error("n8n did not become healthy");
    console.log("PASS: n8n health (real container boots)");

    const webhookUrl = `http://localhost:${N8N_PORT}/webhook/order-paid-email`;

    // n8n registers active workflow webhooks asynchronously after /healthz is
    // green, and answers 404 or 503 while the loading window is still open.
    // Only a 200 proves the route is really registered. The probe uses an
    // INVALID signature, so this doubles as the invalid-signature check below
    // (it must reach the provider ZERO times).
    let registered = false;
    let sawProviderCall = false;
    for (let i = 0; i < 90 && !registered; i++) {
      const probeBody = { jobId: "smoke-probe", type: "ORDER_PAID_EMAIL", payload: {} };
      try {
        const r = await fetchWithTimeout(webhookUrl, {
          method: "POST",
          headers: signedDispatchHeaders(probeBody, "smoke-probe-" + i, { path: "/webhook/order-paid-email", badSignature: true }),
          body: JSON.stringify(probeBody),
        });
        if (r.status === 200) registered = true;
      } catch {}
      if (counts.resend.length !== 0 || counts.nexusComplete.length !== 0 || counts.nexusFail.length !== 0) {
        sawProviderCall = true;
      }
      if (!registered) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!registered) throw new Error("webhook /webhook/order-paid-email never registered on the running n8n");
    if (sawProviderCall || counts.resend.length !== 0) {
      throw new Error(`invalid signature reached provider! resend count=${counts.resend.length}`);
    }
    if (counts.nexusComplete.length !== 0 || counts.nexusFail.length !== 0) {
      throw new Error("invalid signature produced a Nexus callback");
    }
    console.log("PASS: webhook registered; invalid-signature probe reached provider ZERO times");

    // Execute the order-paid email workflow with a valid signed dispatch.
    const jobId = "smoke-job-" + Date.now();
    const requestId = "smoke-dispatch-" + Date.now();
    const payloadObj = {
      jobId,
      type: "ORDER_PAID_EMAIL",
      payload: { orderId: "ord-smoke-1", recipientEmail: "customer@example.test", providerIdempotencyKey: "email:order-paid:smoke-1" },
    };
    const res1 = await fetchWithTimeout(`http://localhost:${N8N_PORT}/webhook/order-paid-email`, {
      method: "POST",
      headers: signedDispatchHeaders(payloadObj, requestId, { path: "/webhook/order-paid-email" }),
      body: JSON.stringify(payloadObj),
    });
    console.log(`valid dispatch HTTP status: ${res1.status}`);

    await waitFor(() => counts.resend.length >= 1, 45000, "mock Resend call");
    const key1 = counts.resend[0].idempotencyKey;
    if (key1 !== "email:order-paid:smoke-1") {
      throw new Error("Provider did not receive authoritative Idempotency-Key (got: " + key1 + ")");
    }
    console.log("PASS: valid signed dispatch reached mock Resend exactly once with authoritative Idempotency-Key");

    await waitFor(() => counts.nexusComplete.some((c) => c.path.includes(jobId) && c.sigOk), 45000, "signed complete callback");
    console.log("PASS: n8n -> Nexus callback arrived with valid HMAC signature");

    // Replay: same signed request again (same requestId) -> replay guard blocks BEFORE provider.
    const res2 = await fetchWithTimeout(`http://localhost:${N8N_PORT}/webhook/order-paid-email`, {
      method: "POST",
      headers: signedDispatchHeaders(payloadObj, requestId, { path: "/webhook/order-paid-email" }),
      body: JSON.stringify(payloadObj),
    });
    await new Promise((r) => setTimeout(r, 4000));
    if (counts.resend.length !== 1) {
      throw new Error(`Replay reached provider! resend count=${counts.resend.length}`);
    }
    console.log(`PASS: replayed requestId rejected (HTTP ${res2.status}); provider calls still exactly 1`);

    // Invalid HMAC -> zero provider calls.
    const badBody = { ...payloadObj, jobId: jobId + "-x" };
    const res3 = await fetchWithTimeout(`http://localhost:${N8N_PORT}/webhook/order-paid-email`, {
      method: "POST",
      headers: signedDispatchHeaders(badBody, "smoke-bad-sig-" + Date.now(), { path: "/webhook/order-paid-email", badSignature: true }),
      body: JSON.stringify(badBody),
    });
    // Wrong service -> zero provider calls.
    const wrongBody = { ...payloadObj, jobId: jobId + "-y" };
    const res4 = await fetchWithTimeout(`http://localhost:${N8N_PORT}/webhook/order-paid-email`, {
      method: "POST",
      headers: signedDispatchHeaders(wrongBody, "smoke-wrong-svc-" + Date.now(), { path: "/webhook/order-paid-email", service: "attacker" }),
      body: JSON.stringify(wrongBody),
    });
    await new Promise((r) => setTimeout(r, 4000));
    if (counts.resend.length !== 1) {
      throw new Error(`Invalid HMAC/wrong service reached provider! resend count=${counts.resend.length}`);
    }
    console.log(`PASS: invalid signature (HTTP ${res3.status}) and wrong service (HTTP ${res4.status}) reached provider ZERO times`);

    console.log("=== N8N RUNTIME SMOKE: ALL CHECKS PASSED ===");
  } catch (err) {
    console.error("❌ SMOKE FAILED:", err.message);
    const logs = docker(["logs", "--tail=60", N8N_NAME], { tolerateFailure: true });
    console.error(logs.stdout, logs.stderr);
    exitCode = 1;
  } finally {
    docker(["rm", "-f", N8N_NAME], { tolerateFailure: true });
    mockServer?.close();
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("❌ SMOKE FATAL:", e);
  try { docker(["rm", "-f", N8N_NAME], { tolerateFailure: true }); } catch {}
  process.exit(1);
});
