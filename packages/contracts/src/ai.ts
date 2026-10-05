/**
 * Phase 19 — AI Marketing OS contracts (skills, contexts, executions, approvals).
 */

export type AiToolRisk = "READ" | "WRITE_LOW_RISK" | "WRITE_HIGH_RISK";
export type AiContextScope = "SYSTEM" | "ORGANIZATION" | "CLIENT";
export type AiExecutionStatus = "RUNNING" | "SUCCEEDED" | "FAILED";
export type AiApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface AiSkillDto {
  name: string;
  description: string;
  version: string;
  scope: string;
  triggers: string[];
  tools: string[];
  maxRisk: AiToolRisk;
  related: string[];
  /** SHA-256 of SKILL.md, recorded on every execution that used the skill. */
  contentHash: string;
}

export interface AiToolDto {
  name: string;
  risk: AiToolRisk;
  description: string;
  requiresApproval: boolean;
}

export interface AiWorkflowDto {
  name: string;
  version: string;
  description: string;
  skills: string[];
  tools: string[];
}

/** Structured marketing context. Every section is free text written by the business. */
export interface AiContextContent {
  productOverview?: string;
  targetAudience?: string;
  problems?: string;
  positioning?: string;
  competition?: string;
  differentiation?: string;
  brandVoice?: string;
  customerLanguage?: string;
  proofPoints?: string;
  goals?: string;
  metrics?: string;
}

export interface AiContextVersionDto {
  id: string;
  version: number;
  content: AiContextContent;
  contentHash: string;
  changeReason: string;
  createdById: string | null;
  createdAt: string;
}

export interface AiContextDto {
  id: string;
  scope: AiContextScope;
  tenantId: string | null;
  key: string;
  currentVersion: number;
  current: AiContextVersionDto | null;
  updatedAt: string;
}

export interface CreateAiContextVersionRequest {
  scope: Exclude<AiContextScope, "SYSTEM">;
  tenantId: string;
  content: AiContextContent;
  /** Required: why the context changed (kept forever in the version history). */
  changeReason: string;
  /** Optimistic concurrency: the version the editor started from (0 for a new context). */
  baseVersion: number;
}

export interface CreateAiExecutionRequest {
  workflow: "weekly-marketing-review";
  tenantId: string;
  /** Optional: last day of the reviewed week (YYYY-MM-DD). Defaults to yesterday. */
  weekEnding?: string;
  idempotencyKey?: string;
}

export interface AiExecutionStepDto {
  seq: number;
  name: string;
  kind: string;
  risk: AiToolRisk | null;
  status: "SUCCEEDED" | "FAILED" | "BLOCKED";
  inputSummary: unknown;
  outputSummary: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface AiExecutionDto {
  id: string;
  tenantId: string;
  userId: string;
  workflow: string;
  workflowVersion: string;
  skills: string[];
  contextVersions: Record<string, { contextId: string; version: number } | null>;
  status: AiExecutionStatus;
  provider: string | null;
  model: string | null;
  resultSummary: string | null;
  result: WeeklyMarketingReview | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: AiExecutionStepDto[];
  reportDraftId: string | null;
}

export interface WeeklyReviewMetric {
  key: string;
  label: string;
  unit: "count" | "money" | "ratio" | "multiplier";
  current: number | null;
  previous: number | null;
  change: number | null;
}

export interface WeeklyReviewAnomaly {
  metric: string;
  channel: string | null;
  severity: "info" | "warning" | "critical";
  direction: "up" | "down";
  change: number;
  message: string;
}

export interface WeeklyReviewRecommendation {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  rationale: string;
  /** Suggested follow-up. High-risk actions are proposals only and need human approval. */
  proposedAction: { tool: string; risk: AiToolRisk; requiresApproval: boolean } | null;
}

/** Output contract of the weekly-marketing-review workflow (validated before it is stored). */
export interface WeeklyMarketingReview {
  schemaVersion: "1.0";
  period: { from: string; to: string; previousFrom: string; previousTo: string; currency: string };
  summary: { headline: string; narrative: string; dataQuality: "ok" | "partial" | "no_data" };
  metrics: WeeklyReviewMetric[];
  anomalies: WeeklyReviewAnomaly[];
  recommendations: WeeklyReviewRecommendation[];
  confidence: { score: number; reasons: string[] };
}

export interface AiActionApprovalDto {
  id: string;
  executionId: string;
  tenantId: string;
  tool: string;
  risk: AiToolRisk;
  payload: unknown;
  status: AiApprovalStatus;
  requestedById: string;
  decidedById: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
}

export interface RequestAiActionRequest {
  tool: string;
  payload: Record<string, unknown>;
}

export interface RequestAiActionResponse {
  outcome: "EXECUTED" | "APPROVAL_REQUIRED" | "DENIED";
  approvalId: string | null;
  result: unknown;
  message: string;
}
