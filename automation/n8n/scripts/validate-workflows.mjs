#!/usr/bin/env node

/**
 * NEXUSTHEME Phase 12 n8n workflow validator.
 * Graph-aware: parses nodes + connections and enforces security invariants.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workflowsDir = path.resolve(__dirname, "../workflows");

const FORBIDDEN_NODE_TYPES = [
  "n8n-nodes-base.postgres",
  "n8n-nodes-base.mysql",
  "n8n-nodes-base.supabase",
  "n8n-nodes-base.mongoDb",
  "n8n-nodes-base.redis",
];

const FORBIDDEN_SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"'`]+/i,
  /redis:\/\/[^\s"'`]*:[^\s"'`@]+@/i,
  /sk_live_[0-9a-zA-Z]{24,}/,
  /sk_test_[0-9a-zA-Z]{24,}/,
  /re_[0-9a-zA-Z]{24,}/,
  /bearer\s+[a-zA-Z0-9_\-\.]{30,}/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
];

const FORBIDDEN_ENV_SECRETS = [
  /\$env\.OPENAI_API_KEY/,
  /\$env\.RESEND_API_KEY/,
];

const EMAIL_WORKFLOWS = new Set([
  "order-paid-email.json",
  "license-provisioned-email.json",
]);

const WORKFLOW_JOB_TYPES = {
  "order-paid-email.json": "ORDER_PAID_EMAIL",
  "license-provisioned-email.json": "LICENSE_PROVISIONED_EMAIL",
  "cms-ai-draft.json": "CMS_AI_DRAFT",
};

console.log("=== NEXUSTHEME N8N WORKFLOW VALIDATION (graph-aware) ===");

if (!fs.existsSync(workflowsDir)) {
  console.error(`ERROR: Workflows directory does not exist: ${workflowsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("ERROR: No workflow JSON files found.");
  process.exit(1);
}

let hasErrors = false;
const fail = (msg) => {
  console.error(`  ❌ ${msg}`);
  hasErrors = true;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Upstream ancestors (nodes with a path leading to the given node). */
function ancestorsOf(workflow, targetName) {
  const ancestors = new Set();
  const queue = [targetName];
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const [from, conn] of Object.entries(workflow.connections || {})) {
      const outs = [];
      for (const main of conn.main || []) for (const l of main || []) outs.push(l.node);
      if (outs.includes(cur) && !ancestors.has(from)) {
        ancestors.add(from);
        queue.push(from);
      }
    }
  }
  return ancestors;
}

for (const file of files) {
  console.log(`\nValidating workflow: ${file}`);
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(path.join(workflowsDir, file), "utf8"));
    ok("Valid JSON structure");
  } catch (err) {
    fail(`Invalid JSON syntax: ${err.message}`);
    continue;
  }

  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    fail("Workflow must contain a non-empty nodes array");
    continue;
  }

  const nodeByName = new Map(workflow.nodes.map((n) => [n.name, n]));

  // 1. Forbidden business-DB nodes
  const dbNodes = workflow.nodes.filter((n) =>
    FORBIDDEN_NODE_TYPES.some((f) => (n.type || "").toLowerCase().includes(f.toLowerCase())),
  );
  if (dbNodes.length > 0) {
    fail(`Forbidden business-DB node(s): ${dbNodes.map((n) => n.name).join(", ")}`);
  } else {
    ok("Zero business database nodes");
  }

  // 2. Secret / credential scan
  const content = JSON.stringify(workflow);
  for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
    if (pattern.test(content)) fail(`Potential embedded credential matching ${pattern}`);
  }
  for (const pattern of FORBIDDEN_ENV_SECRETS) {
    if (pattern.test(content)) {
      fail(`Provider API key must come from n8n credential store, not $env: ${pattern}`);
    }
  }
  ok("Zero hardcoded credentials / DB URIs / $env provider keys");

  // 3. No hardcoded localhost endpoints
  if (content.includes("http://localhost") || content.includes("http://127.0.0.1")) {
    fail("Hardcoded localhost/loopback URL in workflow definition");
  } else {
    ok("Zero hardcoded localhost endpoints");
  }

  // 4. Graph: webhook -> Verify Nexus Dispatch (only)
  const trigger = workflow.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
  if (!trigger) {
    fail("Missing webhook trigger node");
    continue;
  }
  const firstTargets = (workflow.connections?.[trigger.name]?.main?.[0] || []).map((l) => l.node);
  if (firstTargets.length !== 1 || firstTargets[0] !== "Verify Nexus Dispatch") {
    fail(`Webhook must connect ONLY to "Verify Nexus Dispatch" (got: ${firstTargets.join(", ")})`);
  } else {
    ok("Webhook connects directly (and only) to Verify Nexus Dispatch");
  }
  // Stable webhookId: n8n builds the production URL as
  // `${N8N_BASE_URL}/webhook/${webhookId}/${path}`. Without it n8n assigns a
  // random uuid, so the worker route env var could never be deterministic.
  if (trigger.webhookId !== "nexustheme") {
    fail(`Webhook node must declare the stable webhookId "nexustheme" (got: ${String(trigger.webhookId)})`);
  } else {
    ok("Webhook declares stable webhookId and registers at /webhook/<path> (no random uuid)");
  }
  if (trigger.typeVersion === undefined || Number(trigger.typeVersion) < 2) {
    fail(`Webhook node must use typeVersion >= 2 for a stable webhookId path (got: ${String(trigger.typeVersion)})`);
  }
  if (trigger.parameters?.httpMethod !== "POST") {
    fail(`Webhook must be POST (got: ${String(trigger.parameters?.httpMethod)})`);
  }

  const verify = nodeByName.get("Verify Nexus Dispatch");
  if (!verify || verify.type !== "n8n-nodes-base.code" || !verify.parameters?.jsCode) {
    fail("Missing Verify Nexus Dispatch code node");
    continue;
  }
  const code = verify.parameters.jsCode;

  // 5. Verification content checks
  const expectedType = WORKFLOW_JOB_TYPES[file] || "";
  const codeChecks = [
    ["worker service identity", "!== 'worker'"],
    ["timestamp skew check", "5 * 60 * 1000"],
    ["request id requirement", "x-nexus-request-id"],
    ["hex signature validation", "/^[0-9a-fA-F]{64}$/"],
    ["HMAC computation", "crypto.createHmac"],
    ["timing-safe comparison", "crypto.timingSafeEqual"],
    ["replay protection key", "nexus:n8n:dispatch-replay:"],
    ["replay duplicate rejection", "Replay detected"],
    ["replay fail-closed", "fail-closed"],
    ["replay atomic NX claim", "enc('NX')"],
    ["job type binding", `'${expectedType}'`],
    ["secret strength guard", "Insecure AUTOMATION_SERVICE_SECRET configured"],
  ];
  const missingChecks = codeChecks.filter(([, needle]) => !code.includes(needle));
  if (missingChecks.length > 0) {
    for (const [label] of missingChecks) fail(`Verify Nexus Dispatch missing ${label}`);
  } else {
    ok("Verify node: service binding, timestamp, hex validation, timing-safe HMAC, replay guard, job type binding");
  }
  if (/signature\s*!==\s*expectedSig/.test(code) || /signature\s*===\s*expectedSig/.test(code)) {
    fail("Verify node must NOT use plain string equality for HMAC comparison");
  }

  // 6. No provider reachable without verification
  const providerNodes = workflow.nodes.filter(
    (n) => n.type === "n8n-nodes-base.httpRequest" && !/Callback/i.test(n.name),
  );
  for (const p of providerNodes) {
    const anc = ancestorsOf(workflow, p.name);
    if (!anc.has("Verify Nexus Dispatch")) {
      fail(`Provider node "${p.name}" is reachable without passing through Verify Nexus Dispatch`);
    } else {
      ok(`Provider node "${p.name}" reachable only through verification`);
    }
  }

  // 7. Credential STORE usage — references only, no values, no manual Bearer.
  // Allowed n8n-2.40.0 built-in credential types for these providers:
  //   openAiApi        -> predefinedCredentialType (OpenAI bearer injected by n8n)
  //   httpHeaderAuth   -> genericCredentialType   (Resend bearer injected by n8n)
  const ALLOWED_STORE_CREDENTIALS = ["openAiApi", "httpHeaderAuth"];
  const providerHttpNodes = workflow.nodes.filter(
    (n) => n.type === "n8n-nodes-base.httpRequest" && !/Callback/i.test(n.name),
  );
  for (const p of providerHttpNodes) {
    const params = p.parameters || {};
    if (JSON.stringify(params.headerParameters || {}).includes("Authorization")) {
      fail(`Node "${p.name}" manually constructs an Authorization header; use n8n credential store`);
    }
    const creds = p.credentials || {};
    const credKeys = Object.keys(creds);
    if (credKeys.length === 0) {
      fail(`Node "${p.name}" declares no n8n credential reference`);
      continue;
    }
    const authType = credKeys[0];
    if (!ALLOWED_STORE_CREDENTIALS.includes(authType)) {
      fail(`Node "${p.name}" references non-store credential type "${authType}"`);
    }
    if (params.authentication === "genericCredentialType" && params.genericAuthType !== authType) {
      fail(`Node "${p.name}" genericAuthType "${params.genericAuthType}" does not match credential "${authType}"`);
    }
    if (params.authentication === "predefinedCredentialType" && params.nodeCredentialType !== authType) {
      fail(`Node "${p.name}" nodeCredentialType "${params.nodeCredentialType}" does not match credential "${authType}"`);
    }
    // Reference only: id + name. Any extra key would be a committed secret.
    const extra = Object.keys(creds[authType] || {}).filter((k) => k !== "id" && k !== "name");
    if (extra.length > 0) {
      fail(`Node "${p.name}" credential object contains non-reference fields: ${extra.join(", ")}`);
    }
    if (!creds[authType]?.id || !creds[authType]?.name) {
      fail(`Node "${p.name}" credential reference must declare id + name`);
    }
  }
  if (providerHttpNodes.length > 0) {
    ok("Provider credentials are n8n credential-store references only (openAiApi/httpHeaderAuth)");
  }

  // 8. Signed callback to internal API
  const callbackNodes = workflow.nodes.filter(
    (n) => n.type === "n8n-nodes-base.httpRequest" && /Nexus Callback/i.test(n.name),
  );
  if (callbackNodes.length === 0) {
    fail("Missing signed Nexus callback node");
  } else {
    const allInternal = callbackNodes.every((n) => {
      const url = String(n.parameters?.url || "");
      return url.includes("/v1/internal/automation/") || url.includes("NEXUS_API_BASE_URL");
    });
    if (!allInternal) fail("Callback nodes must target /v1/internal/automation/ endpoints");
    const hasSuccessCb = callbackNodes.some((n) => /Complete|Save AI Draft/i.test(n.name));
    const hasFailCb = callbackNodes.some((n) => /Fail Job/i.test(n.name));
    if (!hasSuccessCb) fail("Missing success callback node (complete / content-ai-draft-result)");
    if (!hasFailCb) fail("Missing failure callback node (POST /jobs/:id/fail) — provider failures must classify, not expire silently");
    if (hasSuccessCb && hasFailCb && allInternal) {
      ok("Signed success AND failure callbacks to internal API present");
    }
  }

  // 9. Email idempotency (§17)
  if (EMAIL_WORKFLOWS.has(file)) {
    const provider = workflow.nodes.find(
      (n) => n.type === "n8n-nodes-base.httpRequest" && !/Callback/i.test(n.name),
    );
    const providerJson = JSON.stringify(provider || {});
    if (!providerJson.includes("Idempotency-Key")) {
      fail("Email workflow provider call missing Idempotency-Key header");
    } else if (!providerJson.includes("providerIdempotencyKey")) {
      fail("Idempotency-Key must reference the authoritative payload providerIdempotencyKey");
    } else {
      ok("Provider Idempotency-Key sourced from payload.providerIdempotencyKey (no random key generation)");
    }
    if (/Math\.random|randomUUID|uuidv4/.test(providerJson)) {
      fail("Provider node must not generate random idempotency keys");
    }
  }

}

console.log("\n==========================================");
if (hasErrors) {
  console.error("❌ N8N WORKFLOW VALIDATION FAILED: Violations found.");
  process.exit(1);
}
console.log(`✓ ALL ${files.length} N8N WORKFLOWS PASSED VALIDATION!`);
process.exit(0);