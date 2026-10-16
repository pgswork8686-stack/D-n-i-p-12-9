import React from "react";
import { Badge } from "@nexus/ui";
import type { ServiceMilestoneStatus, ServiceProjectStatus } from "@nexus/contracts";
import { MILESTONE_STATUS_LABELS, PROJECT_STATUS_LABELS } from "./labels";

const PROJECT_VARIANT: Record<ServiceProjectStatus, "success" | "warning" | "error" | "info"> = {
  PLANNING: "info",
  IN_PROGRESS: "warning",
  ON_HOLD: "info",
  IN_REVIEW: "warning",
  COMPLETED: "success",
  CANCELLED: "error",
};

const MILESTONE_VARIANT: Record<ServiceMilestoneStatus, "success" | "warning" | "error" | "info"> = {
  PENDING: "info",
  IN_PROGRESS: "warning",
  DONE: "success",
  CANCELLED: "error",
};

export function ProjectStatusBadge({ status }: { status: ServiceProjectStatus }) {
  return <Badge variant={PROJECT_VARIANT[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

export function MilestoneStatusBadge({ status }: { status: ServiceMilestoneStatus }) {
  return <Badge variant={MILESTONE_VARIANT[status]}>{MILESTONE_STATUS_LABELS[status]}</Badge>;
}
