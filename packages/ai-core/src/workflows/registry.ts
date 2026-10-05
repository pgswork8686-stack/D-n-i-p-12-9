import type { AiWorkflowDto } from "@nexus/contracts";
import { WEEKLY_REVIEW_WORKFLOW } from "./weekly-marketing-review";

/** Workflows are code (reviewed, versioned, tested); they decide which tools may be called. */
export const WORKFLOWS: Record<string, AiWorkflowDto> = {
  [WEEKLY_REVIEW_WORKFLOW.name]: {
    name: WEEKLY_REVIEW_WORKFLOW.name,
    version: WEEKLY_REVIEW_WORKFLOW.version,
    description: WEEKLY_REVIEW_WORKFLOW.description,
    skills: [...WEEKLY_REVIEW_WORKFLOW.skills],
    tools: [...WEEKLY_REVIEW_WORKFLOW.tools],
  },
};

export function getWorkflow(name: string): AiWorkflowDto | undefined {
  return Object.prototype.hasOwnProperty.call(WORKFLOWS, name) ? WORKFLOWS[name] : undefined;
}
