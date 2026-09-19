#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workflowsDir = path.resolve(__dirname, '../workflows');

const FORBIDDEN_NODE_TYPES = [
  'n8n-nodes-base.postgres',
  'n8n-nodes-base.mysql',
  'n8n-nodes-base.supabase',
  'n8n-nodes-base.mySql',
  'n8n-nodes-base.mongoDb',
  'n8n-nodes-base.redis',
];

const FORBIDDEN_SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"'`]+/i,
  /sk_live_[0-9a-zA-Z]{24,}/,
  /sk_test_[0-9a-zA-Z]{24,}/,
  /re_[0-9a-zA-Z]{24,}/,
  /bearer\s+[a-zA-Z0-9_\-\.]{30,}/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
];

console.log('=== NEXUSTHEME N8N WORKFLOW VALIDATION ===');
console.log(`Scanning directory: ${workflowsDir}`);

if (!fs.existsSync(workflowsDir)) {
  console.error(`ERROR: Workflows directory does not exist: ${workflowsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.error('ERROR: No workflow JSON files found in workflows directory.');
  process.exit(1);
}

let hasErrors = false;

for (const file of files) {
  const filePath = path.join(workflowsDir, file);
  console.log(`\nValidating workflow: ${file}`);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`  ❌ Failed to read file: ${err.message}`);
    hasErrors = true;
    continue;
  }

  // 1. JSON Validity
  let workflow;
  try {
    workflow = JSON.parse(content);
    console.log('  ✓ Valid JSON structure');
  } catch (err) {
    console.error(`  ❌ Invalid JSON syntax: ${err.message}`);
    hasErrors = true;
    continue;
  }

  // 2. Nodes Array Check
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    console.error('  ❌ Workflow must contain a non-empty nodes array');
    hasErrors = true;
    continue;
  }

  // 3. Database Node Prohibition
  for (const node of workflow.nodes) {
    const nodeType = node.type || '';
    if (FORBIDDEN_NODE_TYPES.some(forbidden => nodeType.toLowerCase().includes(forbidden.toLowerCase()))) {
      console.error(`  ❌ Forbidden database node detected: "${node.name}" (${nodeType})`);
      hasErrors = true;
    }
  }

  if (!hasErrors) {
    console.log('  ✓ Zero database nodes detected (Pure HTTP orchestration)');
  }

  // 4. Secret & Credential Scanning
  for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
    if (pattern.test(content)) {
      console.error(`  ❌ Potential embedded credential / connection string matching ${pattern}`);
      hasErrors = true;
    }
  }

  if (!hasErrors) {
    console.log('  ✓ Zero hardcoded credentials or database URIs detected');
  }

  // 5. Check for hardcoded localhost endpoints
  if (content.includes('http://localhost') || content.includes('http://127.0.0.1')) {
    console.error('  ❌ Hardcoded localhost/loopback URL found in workflow definition');
    hasErrors = true;
  } else {
    console.log('  ✓ Zero hardcoded localhost/loopback endpoints');
  }

  // 6. Inbound Dispatch Verification Check
  const triggerNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
  if (triggerNode) {
    const triggerConnections = workflow.connections?.[triggerNode.name]?.main?.[0] || [];
    const firstTarget = triggerConnections[0]?.node;
    if (firstTarget !== 'Verify Nexus Dispatch') {
      console.error(`  ❌ Webhook trigger "${triggerNode.name}" does not connect directly to "Verify Nexus Dispatch" (connected to: "${firstTarget}")`);
      hasErrors = true;
    } else {
      console.log('  ✓ Webhook trigger connects directly to "Verify Nexus Dispatch"');
    }

    const verifyNode = workflow.nodes.find(n => n.name === 'Verify Nexus Dispatch');
    if (!verifyNode || !verifyNode.parameters?.jsCode) {
      console.error('  ❌ Missing or invalid "Verify Nexus Dispatch" code node');
      hasErrors = true;
    } else {
      const code = verifyNode.parameters.jsCode;
      if (!code.includes('worker') || !code.includes('AUTOMATION_SERVICE_SECRET') || !code.includes('crypto.createHmac')) {
        console.error('  ❌ "Verify Nexus Dispatch" node must verify worker service identity and HMAC signature');
        hasErrors = true;
      } else {
        console.log('  ✓ "Verify Nexus Dispatch" node validates worker service identity and HMAC signature');
      }
    }
  }
}

console.log('\n==========================================');
if (hasErrors) {
  console.error('❌ N8N WORKFLOW VALIDATION FAILED: Violations found.');
  process.exit(1);
} else {
  console.log(`✓ ALL ${files.length} N8N WORKFLOWS PASSED VALIDATION!`);
  process.exit(0);
}
