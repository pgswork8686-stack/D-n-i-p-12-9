// NEXUSTHEME Phase 12 — n8n workflow generator (single source of truth).
//
// The three committed workflow JSON files under automation/n8n/workflows are
// generated from this script so their ingress security (webhook -> verify ->
// provider -> signed callback) stays identical. Run `pnpm n8n:build` after
// editing, then `pnpm n8n:validate`.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const outDir = path.resolve(__dirname, "../workflows");
// Stable webhookId shared by all NEXUSTHEME workflows (exported workflows must
// not carry a random uuid). With a static `path`, n8n registers the production
// URL as `${N8N_BASE_URL}/webhook/${path}` — verified against n8n 2.40.0 in
// automation/n8n/scripts/runtime-smoke.mjs.
const NEXUS_WEBHOOK_ID = "nexustheme";

// Credential REFERENCES only — never credential values. These ids/names are the
// identifiers an operator creates once inside the n8n credential store.
const NEXUS_CREDENTIAL_IDS = {
  resend: "nexustheme-resend",
  openai: "nexustheme-openai",
};
const NEXUS_CREDENTIAL_NAMES = {
  resend: "NEXUSTHEME Resend (Header Auth: Authorization = Bearer <key>)",
  openai: "NEXUSTHEME OpenAI",
};
const J = "\n"; // real newline used to join code lines
const NL = String.fromCharCode(92) + "n"; // two chars: backslash + n (in-code escape)
const CRNL = String.fromCharCode(92) + "r" + String.fromCharCode(92) + "n"; // backslash-r backslash-n

function verifyCode(webhookPath, expectedType) {
  return [
    "const crypto = require('crypto');",
    "const net = require('net');",
    "const secret = $env.AUTOMATION_SERVICE_SECRET;",
    "const headers = $input.first().json.headers || {};",
    "const body = $input.first().json.body || {};",
    "const lc = (o, n) => { for (const k of Object.keys(o || {})) { if (k.toLowerCase() === n) return o[k]; } return undefined; };",
    "",
    "const service = lc(headers, 'x-nexus-service');",
    "if (service !== 'worker') {",
    "  throw new Error('Unauthorized: Expected X-Nexus-Service: worker');",
    "}",
    "",
    "const timestamp = lc(headers, 'x-nexus-timestamp');",
    "if (!timestamp) {",
    "  throw new Error('Unauthorized: Missing X-Nexus-Timestamp');",
    "}",
    "",
    "const now = Date.now();",
    "const parsedTs = Number(timestamp);",
    "if (!Number.isFinite(parsedTs) || Math.abs(now - parsedTs) > 5 * 60 * 1000) {",
    "  throw new Error('Unauthorized: Timestamp skew exceeded 5 minutes');",
    "}",
    "",
    "const requestId = lc(headers, 'x-nexus-request-id');",
    "if (!requestId) {",
    "  throw new Error('Unauthorized: Missing X-Nexus-Request-Id');",
    "}",
    "",
    "const signature = lc(headers, 'x-nexus-signature');",
    "if (!signature) {",
    "  throw new Error('Unauthorized: Missing X-Nexus-Signature');",
    "}",
    "if (!/^[0-9a-fA-F]{64}$/.test(String(signature))) {",
    "  throw new Error('Unauthorized: Signature is not valid 64-char hex');",
    "}",
    "",
    "const payload = typeof body === 'string' ? JSON.parse(body) : body;",
    "if (!payload || !payload.jobId) {",
    "  throw new Error('Unauthorized: Missing jobId');",
    "}",
    "if (payload.type !== '" + expectedType + "') {",
    "  throw new Error('Unauthorized: Wrong job type for this workflow: ' + payload.type);",
    "}",
    "",
    "const path = '/webhook/" + webhookPath + "';",
    "const rawBody = typeof body === 'string' ? body : JSON.stringify(body);",
    "const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');",
    "const canonical = [service, 'POST', path, String(timestamp), requestId, bodyHash].join('" + NL + "');",
    "const expectedSig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');",
    "",
    "// Timing-safe comparison (never ordinary string equality for HMAC).",
    "const sigBuf = Buffer.from(String(signature), 'hex');",
    "const expBuf = Buffer.from(expectedSig, 'hex');",
    "if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {",
    "  throw new Error('Unauthorized: Invalid HMAC signature from worker');",
    "}",
    "",
    "// Ingress replay protection BEFORE any provider call (fail-closed).",
    "// Atomic Redis claim over RESP: SET key 1 NX PX 600000",
    "// NX => only the FIRST request for a requestId can claim the key.",
    "// A duplicate gets a nil reply (duplicate) and MUST be rejected.",
    "const redisHost = $env.N8N_REPLAY_REDIS_HOST || '127.0.0.1';",
    "const redisPort = Number($env.N8N_REPLAY_REDIS_PORT || 6379);",
    "const redisPassword = $env.N8N_REPLAY_REDIS_PASSWORD || '';",
    "const CRLF = '" + CRNL + "';",
    "const replayKey = 'nexus:n8n:dispatch-replay:' + requestId;",
    "const claim = await new Promise((resolve, reject) => {",
    "  const socket = net.createConnection({ host: redisHost, port: redisPort });",
    "  let buf = '';",
    "  const fail = (e) => { try { socket.destroy(); } catch (_) {} reject(new Error('Replay protection unavailable (fail-closed): ' + e.message)); };",
    "  socket.setTimeout(3000);",
    "  socket.on('timeout', () => fail(new Error('Redis timeout')));",
    "  socket.on('error', fail);",
    "  socket.on('connect', () => {",
    "    const enc = (s) => '$' + Buffer.byteLength(s) + CRLF + s + CRLF;",
    "    if (redisPassword) {",
    "      socket.write('*2' + CRLF + '$4' + CRLF + 'AUTH' + CRLF + enc(redisPassword));",
    "    }",
    "    socket.write('*6' + CRLF + '$3' + CRLF + 'SET' + CRLF + enc(replayKey) + enc('1') + enc('NX') + enc('PX') + enc('600000'));",
    "  });",
    "  socket.on('data', (d) => {",
    "    buf += d.toString();",
    "    // Wait for a complete RESP line, then classify the LAST reply",
    "    // (so a pipelined AUTH '+OK' can never be mistaken for the SET result).",
    "    if (!buf.endsWith(CRLF)) return;",
    "    const lines = buf.split(CRLF).filter((l) => l.length > 0);",
    "    const last = lines[lines.length - 1];",
    "    if (!last) return;",
    "    if (last === '+OK') { try { socket.destroy(); } catch (_) {} resolve('claimed'); return; }",
    "    if (last === '$-1' || last === '_') { try { socket.destroy(); } catch (_) {} resolve('duplicate'); return; }",
    "    if (last.charAt(0) === '-') { try { socket.destroy(); } catch (_) {} reject(new Error('Replay protection rejected (fail-closed): ' + last)); return; }",
    "    return;",
    "  });",
    "});",
    "if (claim === 'duplicate') {",
    "  throw new Error('Unauthorized: Replay detected for requestId ' + requestId);",
    "}",
    "",
    "return [$input.first()];",
  ].join(J);
}

function signCompleteCode(callbackPath, requestIdPrefix) {
  return [
    "const crypto = require('crypto');",
    "const secret = $env.AUTOMATION_SERVICE_SECRET;",
    "const jobId = $('Webhook Trigger').first().json.body.jobId;",
    "const emailResult = $input.first().json || {};",
    "const providerMessageId = emailResult.id || 'simulated';",
    "",
    "const body = {",
    "  providerMessageId,",
    "  resultJson: {",
    "    sent: true,",
    "    providerMessageId",
    "  }",
    "};",
    "",
    "const service = 'n8n';",
    "const timestamp = Date.now().toString();",
    "const requestId = '" + requestIdPrefix + "' + jobId + '-' + timestamp;",
    "const callbackPath = '/v1/internal/automation/jobs/' + jobId + '/complete';",
    "const rawBody = JSON.stringify(body);",
    "const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');",
    "const canonical = [service, 'POST', callbackPath, timestamp, requestId, bodyHash].join('" + NL + "');",
    "const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');",
    "",
    "return [{",
    "  json: {",
    "    jobId,",
    "    callbackPath,",
    "    body,",
    "    headers: {",
    "      'Content-Type': 'application/json',",
    "      'X-Nexus-Service': service,",
    "      'X-Nexus-Timestamp': timestamp,",
    "      'X-Nexus-Request-Id': requestId,",
    "      'X-Nexus-Signature': signature,",
    "      'X-Nexus-Signature-Version': 'v1'",
    "    }",
    "  }",
    "}];",
  ].join(J);
}

function signFailCode(errorPrefix) {
  return [
    "const crypto = require('crypto');",
    "const secret = $env.AUTOMATION_SERVICE_SECRET;",
    "const jobId = $('Webhook Trigger').first().json.body.jobId;",
    "const errItem = $input.first().json || {};",
    "const providerErr = errItem.error || errItem;",
    "const status = Number(providerErr.httpCode || providerErr.statusCode || providerErr.status || 0);",
    "let errorCode = '" + errorPrefix + "_TIMEOUT';",
    "if (status === 429) { errorCode = '" + errorPrefix + "_HTTP_429'; }",
    "else if (status >= 500) { errorCode = '" + errorPrefix + "_HTTP_5XX'; }",
    "else if (status >= 400) { errorCode = '" + errorPrefix + "_HTTP_' + status; }",
    "const errorMessage = ('Provider call failed' + (status ? ' [HTTP ' + status + ']' : '')).slice(0, 1000);",
    "const retryable = status === 429 || status >= 500 || status === 0;",
    "",
    "const body = { errorCode, errorMessage, retryable };",
    "const service = 'n8n';",
    "const timestamp = Date.now().toString();",
    "const requestId = 'cb-fail-' + jobId + '-' + timestamp;",
    "const callbackPath = '/v1/internal/automation/jobs/' + jobId + '/fail';",
    "const rawBody = JSON.stringify(body);",
    "const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');",
    "const canonical = [service, 'POST', callbackPath, timestamp, requestId, bodyHash].join('" + NL + "');",
    "const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');",
    "",
    "return [{",
    "  json: {",
    "    jobId,",
    "    callbackPath,",
    "    body,",
    "    headers: {",
    "      'Content-Type': 'application/json',",
    "      'X-Nexus-Service': service,",
    "      'X-Nexus-Timestamp': timestamp,",
    "      'X-Nexus-Request-Id': requestId,",
    "      'X-Nexus-Signature': signature,",
    "      'X-Nexus-Signature-Version': 'v1'",
    "    }",
    "  }",
    "}];",
  ].join(J);
}

const callbackHeaders = () => ({
  method: "POST",
  url: "={{ $env.NEXUS_API_BASE_URL + $json.callbackPath }}",
  sendHeaders: true,
  headerParameters: {
    parameters: [
      { name: "Content-Type", value: "application/json" },
      { name: "X-Nexus-Service", value: "={{ $json.headers['X-Nexus-Service'] }}" },
      { name: "X-Nexus-Timestamp", value: "={{ $json.headers['X-Nexus-Timestamp'] }}" },
      { name: "X-Nexus-Request-Id", value: "={{ $json.headers['X-Nexus-Request-Id'] }}" },
      { name: "X-Nexus-Signature", value: "={{ $json.headers['X-Nexus-Signature'] }}" },
      { name: "X-Nexus-Signature-Version", value: "={{ $json.headers['X-Nexus-Signature-Version'] }}" },
    ],
  },
  sendBody: true,
  specifyBody: "json",
  jsonBody: "={{ JSON.stringify($json.body) }}",
  options: {},
});

function callbackNodes(signCompleteJs, nodeIdSuffix, errorPrefix) {
  return [
    {
      parameters: { jsCode: signCompleteJs },
      id: "sign-callback-node-" + nodeIdSuffix,
      name: "Sign Callback Payload",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, 300],
    },
    {
      parameters: callbackHeaders(),
      id: "callback-node-" + nodeIdSuffix,
      name: "Nexus Callback (Complete Job)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [1000, 300],
    },
    {
      parameters: { jsCode: signFailCode(errorPrefix) },
      id: "sign-fail-callback-node-" + nodeIdSuffix,
      name: "Sign Fail Callback Payload",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, 520],
    },
    {
      parameters: callbackHeaders(),
      id: "fail-callback-node-" + nodeIdSuffix,
      name: "Nexus Callback (Fail Job)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [1000, 520],
    },
  ];
}

function workflow(name, webhookPath, expectedType, verifyJs, providerNode, signCompleteJs, nodeIdSuffix, errorPrefix) {
  const signName = "Sign Callback Payload";
  const cb = callbackNodes(signCompleteJs, nodeIdSuffix, errorPrefix);
  return {
    name,
    nodes: [
      {
        parameters: { httpMethod: "POST", path: webhookPath, responseMode: "onReceived", options: {} },
        // Stable, explicit webhookId. n8n derives the production URL as
        // `${N8N_BASE}/webhook/${webhookId}/${path}` (NodeHelpers.getNodeWebhookPath).
        // Without an explicit webhookId n8n generates a random uuid per node,
        // which would make the worker route URL unstable.
        webhookId: NEXUS_WEBHOOK_ID,
        id: "webhook-node",
        name: "Webhook Trigger",
        type: "n8n-nodes-base.webhook",
        // typeVersion >= 2 keeps the node-level `webhookId` stable and makes
        // n8n register the webhook under the plain configured path
        // (`${N8N_BASE_URL}/webhook/order-paid-email`), verified on n8n 2.40.0.
        typeVersion: 2,
        position: [200, 300],
      },
      {
        parameters: { jsCode: verifyJs },
        id: "verify-dispatch-node",
        name: "Verify Nexus Dispatch",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [400, 300],
      },
      providerNode,
      ...cb,
    ],
    connections: {
      "Webhook Trigger": { main: [[{ node: "Verify Nexus Dispatch", type: "main", index: 0 }]] },
      "Verify Nexus Dispatch": { main: [[{ node: providerNode.name, type: "main", index: 0 }]] },
      [providerNode.name]: {
        main: [
          [{ node: signName, type: "main", index: 0 }],
          [{ node: "Sign Fail Callback Payload", type: "main", index: 0 }],
        ],
      },
      [signName]: { main: [[{ node: "Nexus Callback (Complete Job)", type: "main", index: 0 }]] },
      "Sign Fail Callback Payload": { main: [[{ node: "Nexus Callback (Fail Job)", type: "main", index: 0 }]] },
    },
    active: false,
    settings: {
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "all",
      saveManualExecutions: false,
    },
  };
}

function emailProviderNode(name, jsonBodyLines) {
  return {
    parameters: {
      method: "POST",
      url: "={{ ($env.RESEND_API_BASE_URL || 'https://api.resend.com') + '/emails' }}",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Idempotency-Key", value: "={{ $('Webhook Trigger').first().json.body.payload.providerIdempotencyKey }}" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: jsonBodyLines.join(J),
      options: {},
    },
    // The Resend API key lives ONLY in the n8n credential store. There is no
    // built-in `resendApi` credential type in n8n 2.40.0, so the supported
    // mechanism is the built-in Header Auth credential (header `Authorization`,
    // value `Bearer <key>`), referenced here by id/name only.
    credentials: {
      httpHeaderAuth: { id: NEXUS_CREDENTIAL_IDS.resend, name: NEXUS_CREDENTIAL_NAMES.resend },
    },
    id: "send-email-node",
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.1,
    position: [600, 300],
    onError: "continueErrorOutput",
  };
}

const orderProvider = emailProviderNode("Send Order Receipt Email", [
  "={",
  "  \"from\": \"{{ $env.TRANSACTIONAL_FROM_EMAIL }}\",",
  "  \"to\": \"{{ $('Webhook Trigger').first().json.body.payload.recipientEmail }}\",",
  "  \"subject\": \"Receipt for your NEXUSTHEME order #{{ $('Webhook Trigger').first().json.body.payload.orderId }}\",",
  "  \"html\": \"<p>Thank you for your purchase!</p><p>Your order #{{ $('Webhook Trigger').first().json.body.payload.orderId }} has been confirmed.</p>\"",
  "}",
]);

const licenseProvider = emailProviderNode("Send License Ready Email", [
  "={",
  "  \"from\": \"{{ $env.TRANSACTIONAL_FROM_EMAIL }}\",",
  "  \"to\": \"{{ $('Webhook Trigger').first().json.body.payload.recipientEmail }}\",",
  "  \"subject\": \"Your license is ready!\",",
  "  \"html\": \"<p>Your license key ({{ $('Webhook Trigger').first().json.body.payload.maskedKey }}) has been provisioned.</p><p>View and manage your licenses in your <a href='{{ $env.PORTAL_BASE_URL || 'https://app.domain.com' }}/licenses'>Customer Portal</a>.</p>\"",
  "}",
]);

const wfOrder = workflow(
  "NEXUSTHEME — Order Paid Email Notification",
  "order-paid-email",
  "ORDER_PAID_EMAIL",
  verifyCode("order-paid-email", "ORDER_PAID_EMAIL"),
  orderProvider,
  signCompleteCode("/v1/internal/automation/jobs", "cb-ord-"),
  "order",
  "EMAIL",
);

const wfLicense = workflow(
  "NEXUSTHEME — License Provisioned Email Notification",
  "license-provisioned-email",
  "LICENSE_PROVISIONED_EMAIL",
  verifyCode("license-provisioned-email", "LICENSE_PROVISIONED_EMAIL"),
  licenseProvider,
  signCompleteCode("/v1/internal/automation/jobs", "cb-lic-"),
  "license",
  "EMAIL",
);

const aiPrepareCode = [
  "const body = $('Webhook Trigger').first().json.body || {};",
  "const p = body.payload || {};",
  "const briefText = p.brief || p.topic || 'Generate an article.';",
  "const language = p.language || 'en';",
  "const prompt = 'You are an expert SEO content writer. Write a complete blog article in ' + language + ' based on the following brief. Respond ONLY with a JSON object having keys: title, excerpt, content (HTML), seoTitle, seoDescription, suggestedSlug.' + '\\n\\nBrief: ' + briefText;",
  "return [{ json: { requestBody: {",
  "  model: $env.AI_CONTENT_MODEL || 'gpt-4o',",
  "  response_format: { type: 'json_object' },",
  "  messages: [ { role: 'user', content: prompt } ]",
  "} } }];",
].join(J);

const aiSignCode = [
  "const crypto = require('crypto');",
  "const secret = $env.AUTOMATION_SERVICE_SECRET;",
  "const jobId = $('Webhook Trigger').first().json.body.jobId;",
  "const aiContent = JSON.parse($input.first().json.choices[0].message.content);",
  "",
  "const body = {",
  "  jobId,",
  "  result: {",
  "    title: aiContent.title,",
  "    excerpt: aiContent.excerpt,",
  "    content: aiContent.content,",
  "    seoTitle: aiContent.seoTitle,",
  "    seoDescription: aiContent.seoDescription,",
  "    suggestedSlug: aiContent.suggestedSlug",
  "  }",
  "};",
  "",
  "const service = 'n8n';",
  "const timestamp = Date.now().toString();",
  "const requestId = 'cb-' + jobId + '-' + timestamp;",
  "const path = '/v1/internal/automation/content-ai-draft-result';",
  "const rawBody = JSON.stringify(body);",
  "const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');",
  "const canonical = [service, 'POST', path, timestamp, requestId, bodyHash].join('" + NL + "');",
  "const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');",
  "",
  "return [{",
  "  json: {",
  "    body,",
  "    headers: {",
  "      'Content-Type': 'application/json',",
  "      'X-Nexus-Service': service,",
  "      'X-Nexus-Timestamp': timestamp,",
  "      'X-Nexus-Request-Id': requestId,",
  "      'X-Nexus-Signature': signature,",
  "      'X-Nexus-Signature-Version': 'v1'",
  "    }",
  "  }",
  "}];",
].join(J);

const wfAi = {
  name: "NEXUSTHEME — CMS AI Draft Generation",
  nodes: [
    {
      parameters: { httpMethod: "POST", path: "cms-ai-draft", responseMode: "onReceived", options: {} },
      // Stable webhookId -> production URL ${N8N_BASE_URL}/webhook/cms-ai-draft
      webhookId: NEXUS_WEBHOOK_ID,
      id: "webhook-node",
      name: "Webhook Trigger",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [200, 300],
    },
    {
      parameters: { jsCode: verifyCode("cms-ai-draft", "CMS_AI_DRAFT") },
      id: "verify-dispatch-node",
      name: "Verify Nexus Dispatch",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [400, 300],
    },
    {
      parameters: { jsCode: aiPrepareCode },
      id: "prepare-ai-request-node",
      name: "Prepare AI Request",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [560, 300],
    },
    {
      parameters: {
        method: "POST",
        url: "={{ ($env.OPENAI_API_BASE_URL || 'https://api.openai.com') + '/v1/chat/completions' }}",
        // Provider credentials come from the n8n credential store only.
        authentication: "predefinedCredentialType",
        nodeCredentialType: "openAiApi",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json.requestBody) }}",
        options: { timeout: 120000 },
      },
      credentials: {
        openAiApi: { id: NEXUS_CREDENTIAL_IDS.openai, name: NEXUS_CREDENTIAL_NAMES.openai },
      },
      id: "ai-generate-node",
      name: "Generate Structured Article",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [700, 300],
      onError: "continueErrorOutput",
    },
    {
      parameters: { jsCode: aiSignCode },
      id: "sign-callback-node",
      name: "Sign Callback Payload",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [900, 300],
    },
    {
      parameters: {
        method: "POST",
        url: "={{ $env.NEXUS_API_BASE_URL + '/v1/internal/automation/content-ai-draft-result' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Content-Type", value: "application/json" },
            { name: "X-Nexus-Service", value: "={{ $json.headers['X-Nexus-Service'] }}" },
            { name: "X-Nexus-Timestamp", value: "={{ $json.headers['X-Nexus-Timestamp'] }}" },
            { name: "X-Nexus-Request-Id", value: "={{ $json.headers['X-Nexus-Request-Id'] }}" },
            { name: "X-Nexus-Signature", value: "={{ $json.headers['X-Nexus-Signature'] }}" },
            { name: "X-Nexus-Signature-Version", value: "={{ $json.headers['X-Nexus-Signature-Version'] }}" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json.body) }}",
        options: {},
      },
      id: "callback-node",
      name: "Nexus Callback (Save AI Draft)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [1100, 300],
    },
    {
      parameters: { jsCode: signFailCode("AI") },
      id: "sign-fail-callback-node",
      name: "Sign Fail Callback Payload",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [900, 520],
    },
    {
      parameters: callbackHeaders(),
      id: "fail-callback-node",
      name: "Nexus Callback (Fail Job)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [1100, 520],
    },
  ],
  connections: {
    "Webhook Trigger": { main: [[{ node: "Verify Nexus Dispatch", type: "main", index: 0 }]] },
    "Verify Nexus Dispatch": { main: [[{ node: "Prepare AI Request", type: "main", index: 0 }]] },
    "Prepare AI Request": { main: [[{ node: "Generate Structured Article", type: "main", index: 0 }]] },
    "Generate Structured Article": {
      main: [
        [{ node: "Sign Callback Payload", type: "main", index: 0 }],
        [{ node: "Sign Fail Callback Payload", type: "main", index: 0 }],
      ],
    },
    "Sign Callback Payload": { main: [[{ node: "Nexus Callback (Save AI Draft)", type: "main", index: 0 }]] },
    "Sign Fail Callback Payload": { main: [[{ node: "Nexus Callback (Fail Job)", type: "main", index: 0 }]] },
  },
  active: false,
  settings: {
    saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all",
    saveManualExecutions: false,
  },
};

for (const [file, wf] of [
  ["order-paid-email.json", wfOrder],
  ["license-provisioned-email.json", wfLicense],
  ["cms-ai-draft.json", wfAi],
]) {
  // Stable id so `n8n import:workflow` can insert (n8n requires an id) and
  // re-import/update deterministically on an existing instance.
  wf.id = "nexustheme-" + file.replace(/\.json$/, "");
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(wf, null, 2) + "\n");
  console.log("wrote", file);
}