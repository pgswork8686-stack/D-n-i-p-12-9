import type { WeeklyMarketingReview } from "@nexus/contracts";
import { containsSecret } from "@nexus/utils";

/**
 * Strict validator for the weekly-marketing-review output contract (schemaVersion 1.0).
 * Returns a list of problems; an empty list means the document is valid. Every workflow result
 * is validated before it is stored or returned, including any text produced by a model.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const isStr = (v: unknown, max = 2000) => typeof v === "string" && v.length > 0 && v.length <= max;
const oneOf = (v: unknown, values: readonly string[]) => typeof v === "string" && values.includes(v);

export function validateWeeklyReview(doc: unknown): string[] {
  const errors: string[] = [];
  const d = doc as WeeklyMarketingReview;
  if (!d || typeof d !== "object") return ["result must be an object"];
  if (d.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");

  const p = d.period as any;
  if (!p || !["from", "to", "previousFrom", "previousTo"].every((k) => typeof p[k] === "string" && DATE_RE.test(p[k]))) errors.push("period dates must be YYYY-MM-DD");
  else if (!(p.previousFrom <= p.previousTo && p.previousTo < p.from && p.from <= p.to)) errors.push("period ranges are not ordered");
  if (!p || !oneOf(p.currency, ["VND", "USD"])) errors.push("period.currency must be VND or USD");

  const s = d.summary as any;
  if (!s || !isStr(s.headline, 300) || !isStr(s.narrative, 3000) || !oneOf(s.dataQuality, ["ok", "partial", "no_data"])) errors.push("summary is invalid");

  if (!Array.isArray(d.metrics) || d.metrics.length === 0) errors.push("metrics must be a non-empty array");
  else
    d.metrics.forEach((m, i) => {
      if (!isStr(m.key, 64) || !isStr(m.label, 64) || !oneOf(m.unit, ["count", "money", "ratio", "multiplier"]) || !isNumOrNull(m.current) || !isNumOrNull(m.previous) || !isNumOrNull(m.change)) {
        errors.push(`metrics[${i}] is invalid`);
      }
    });

  if (!Array.isArray(d.anomalies)) errors.push("anomalies must be an array");
  else
    d.anomalies.forEach((a, i) => {
      if (!isStr(a.metric, 64) || !(a.channel === null || isStr(a.channel, 64)) || !oneOf(a.severity, ["info", "warning", "critical"]) || !oneOf(a.direction, ["up", "down"]) || typeof a.change !== "number" || !isStr(a.message, 500)) {
        errors.push(`anomalies[${i}] is invalid`);
      }
    });

  if (!Array.isArray(d.recommendations)) errors.push("recommendations must be an array");
  else
    d.recommendations.forEach((r, i) => {
      const pa = r.proposedAction as any;
      const actionOk = pa === null || (isStr(pa?.tool, 64) && oneOf(pa?.risk, ["READ", "WRITE_LOW_RISK", "WRITE_HIGH_RISK"]) && typeof pa?.requiresApproval === "boolean" && (pa.risk !== "WRITE_HIGH_RISK" || pa.requiresApproval === true));
      if (!isStr(r.id, 64) || !oneOf(r.priority, ["high", "medium", "low"]) || !isStr(r.title, 200) || !isStr(r.rationale, 1000) || !actionOk) {
        errors.push(`recommendations[${i}] is invalid`);
      }
    });

  const c = d.confidence as any;
  if (!c || typeof c.score !== "number" || c.score < 0 || c.score > 1 || !Array.isArray(c.reasons)) errors.push("confidence is invalid");

  if (containsSecret(JSON.stringify(doc))) errors.push("result must not contain secrets");
  return errors;
}
