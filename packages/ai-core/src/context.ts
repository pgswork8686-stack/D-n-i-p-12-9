import * as crypto from "crypto";
import type { AiContextContent } from "@nexus/contracts";
import { containsSecret } from "@nexus/utils";

/** The sections of a marketing context, in display order (Vietnamese labels for the UI). */
export const CONTEXT_SECTIONS: { key: keyof AiContextContent; label: string }[] = [
  { key: "productOverview", label: "Tổng quan sản phẩm" },
  { key: "targetAudience", label: "Khách hàng mục tiêu" },
  { key: "problems", label: "Vấn đề khách hàng gặp phải" },
  { key: "positioning", label: "Định vị" },
  { key: "competition", label: "Đối thủ cạnh tranh" },
  { key: "differentiation", label: "Điểm khác biệt" },
  { key: "brandVoice", label: "Giọng thương hiệu" },
  { key: "customerLanguage", label: "Ngôn ngữ của khách hàng" },
  { key: "proofPoints", label: "Bằng chứng (số liệu thật, case study)" },
  { key: "goals", label: "Mục tiêu" },
  { key: "metrics", label: "Chỉ số theo dõi" },
];

export const MAX_SECTION_CHARS = 5000;

export class ContextValidationError extends Error {}

/** Validates and normalises context content. Rejects unknown sections, oversize text and secrets. */
export function normalizeContextContent(input: unknown): AiContextContent {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ContextValidationError("Nội dung context phải là object");
  const allowed = new Set(CONTEXT_SECTIONS.map((s) => s.key as string));
  const out: AiContextContent = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key)) throw new ContextValidationError(`Mục "${key}" không thuộc cấu trúc context`);
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") throw new ContextValidationError(`Mục "${key}" phải là văn bản`);
    const text = value.replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_SECTION_CHARS) throw new ContextValidationError(`Mục "${key}" vượt quá ${MAX_SECTION_CHARS} ký tự`);
    if (containsSecret(text)) throw new ContextValidationError(`Mục "${key}" có vẻ chứa mật khẩu hoặc khoá bí mật; context không được chứa secret`);
    (out as Record<string, string>)[key] = text;
  }
  if (Object.keys(out).length === 0) throw new ContextValidationError("Context phải có ít nhất một mục");
  return out;
}

/** Stable hash of normalised content (key order independent). */
export function hashContextContent(content: AiContextContent): string {
  const ordered = CONTEXT_SECTIONS.map((s) => [s.key, (content as Record<string, string>)[s.key] ?? null]);
  return crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

/**
 * Effective context for a run: SYSTEM, then ORGANIZATION, then CLIENT. A more specific layer
 * replaces a section; sections it does not define are inherited.
 */
export function mergeContextLayers(layers: Array<AiContextContent | null | undefined>): AiContextContent {
  const merged: AiContextContent = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const s of CONTEXT_SECTIONS) {
      const v = layer[s.key];
      if (typeof v === "string" && v.trim()) merged[s.key] = v;
    }
  }
  return merged;
}
