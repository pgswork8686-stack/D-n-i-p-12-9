import type { AiToolRisk } from "@nexus/contracts";

export const RISK_ORDER: Record<AiToolRisk, number> = { READ: 0, WRITE_LOW_RISK: 1, WRITE_HIGH_RISK: 2 };

export function maxRisk(risks: AiToolRisk[]): AiToolRisk {
  return risks.reduce<AiToolRisk>((acc, r) => (RISK_ORDER[r] > RISK_ORDER[acc] ? r : acc), "READ");
}

export function isRisk(value: unknown): value is AiToolRisk {
  return value === "READ" || value === "WRITE_LOW_RISK" || value === "WRITE_HIGH_RISK";
}

/** WRITE_HIGH_RISK always needs a human approval; there is no configuration to disable this. */
export function requiresHumanApproval(risk: AiToolRisk): boolean {
  return risk === "WRITE_HIGH_RISK";
}
