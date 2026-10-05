import * as crypto from "crypto";
import type { AiToolRisk } from "@nexus/contracts";
import { summarizeForAudit } from "@nexus/utils";
import { requiresHumanApproval } from "./risk";

/**
 * Tool registry + execution policy for AI workflows.
 *
 * - Every tool declares a risk class. READ and WRITE_LOW_RISK tools run when the caller holds
 *   `ai.execute` and the workflow allows the tool. WRITE_HIGH_RISK tools NEVER run without an
 *   APPROVED human approval bound to the exact payload (hash). Phase 19 ships no real
 *   high-risk mutation: the registered high-risk tools are dry-run stubs.
 * - Every invocation (including blocked ones) is reported to the StepRecorder with redacted,
 *   size-limited input/output summaries.
 * - Tools receive the tenant scope from the execution context, never from model output.
 */
export interface ToolContext {
  executionId: string;
  tenantId: string;
  userId: string;
  permissions: ReadonlySet<string>;
  /** Tools this workflow is allowed to call (least privilege per workflow). */
  allowedTools: ReadonlySet<string>;
}

export interface ToolDefinition<I = any, O = any> {
  name: string;
  risk: AiToolRisk;
  description: string;
  handler: (ctx: ToolContext, input: I) => Promise<O>;
}

export interface StepRecord {
  name: string;
  kind: "TOOL" | "COMPUTE" | "LLM";
  risk: AiToolRisk | null;
  status: "SUCCEEDED" | "FAILED" | "BLOCKED";
  inputSummary: unknown;
  outputSummary: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date;
}

export interface StepRecorder {
  record(step: StepRecord): Promise<void>;
}

export interface ApprovalGrant {
  id: string;
  tool: string;
  payloadHash: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

export type ToolOutcome<O> =
  | { outcome: "EXECUTED"; result: O }
  | { outcome: "APPROVAL_REQUIRED"; payloadHash: string }
  | { outcome: "DENIED"; reason: string };

export class ToolPolicyError extends Error {}

export function hashToolPayload(tool: string, payload: unknown): string {
  return crypto.createHash("sha256").update(`${tool}\n${stableStringify(payload)}`).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) throw new ToolPolicyError(`tool ${tool.name} registered twice`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  risks(): Map<string, AiToolRisk> {
    return new Map(this.list().map((t) => [t.name, t.risk]));
  }

  /**
   * Runs a tool under the policy. `approval` is only consulted for WRITE_HIGH_RISK tools and must
   * be APPROVED and bound to the same tool + payload hash.
   */
  async invoke<O = unknown>(
    ctx: ToolContext,
    name: string,
    input: unknown,
    recorder: StepRecorder,
    approval?: ApprovalGrant | null,
  ): Promise<ToolOutcome<O>> {
    const startedAt = new Date();
    const tool = this.tools.get(name);
    const block = async (reason: string, risk: AiToolRisk | null): Promise<ToolOutcome<O>> => {
      await recorder.record({ name, kind: "TOOL", risk, status: "BLOCKED", inputSummary: summarizeForAudit(input), outputSummary: null, error: reason, startedAt, finishedAt: new Date() });
      return { outcome: "DENIED", reason };
    };

    if (!tool) return block(`Công cụ "${name}" không tồn tại`, null);
    if (!ctx.allowedTools.has(name)) return block(`Workflow không được phép dùng công cụ "${name}"`, tool.risk);
    if (!ctx.permissions.has("ai.execute")) return block("Thiếu quyền ai.execute", tool.risk);

    if (requiresHumanApproval(tool.risk)) {
      const payloadHash = hashToolPayload(name, input);
      const valid = approval && approval.status === "APPROVED" && approval.tool === name && approval.payloadHash === payloadHash;
      if (!valid) {
        await recorder.record({ name, kind: "TOOL", risk: tool.risk, status: "BLOCKED", inputSummary: summarizeForAudit(input), outputSummary: null, error: "Cần người duyệt (WRITE_HIGH_RISK)", startedAt, finishedAt: new Date() });
        return { outcome: "APPROVAL_REQUIRED", payloadHash };
      }
    }

    try {
      const result = (await tool.handler(ctx, input)) as O;
      await recorder.record({ name, kind: "TOOL", risk: tool.risk, status: "SUCCEEDED", inputSummary: summarizeForAudit(input), outputSummary: summarizeForAudit(result), error: null, startedAt, finishedAt: new Date() });
      return { outcome: "EXECUTED", result };
    } catch (err: any) {
      const message = String(err?.message || err).slice(0, 500);
      await recorder.record({ name, kind: "TOOL", risk: tool.risk, status: "FAILED", inputSummary: summarizeForAudit(input), outputSummary: null, error: message, startedAt, finishedAt: new Date() });
      throw err;
    }
  }
}

/** Records a non-tool step (pure computation or model call) with the same redaction rules. */
export async function recordStep(
  recorder: StepRecorder,
  name: string,
  kind: "COMPUTE" | "LLM",
  input: unknown,
  run: () => Promise<unknown> | unknown,
): Promise<any> {
  const startedAt = new Date();
  try {
    const output = await run();
    await recorder.record({ name, kind, risk: null, status: "SUCCEEDED", inputSummary: summarizeForAudit(input), outputSummary: summarizeForAudit(output), error: null, startedAt, finishedAt: new Date() });
    return output;
  } catch (err: any) {
    await recorder.record({ name, kind, risk: null, status: "FAILED", inputSummary: summarizeForAudit(input), outputSummary: null, error: String(err?.message || err).slice(0, 500), startedAt, finishedAt: new Date() });
    throw err;
  }
}
