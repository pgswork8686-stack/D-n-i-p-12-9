import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { hashContextContent, normalizeContextContent } from "@nexus/ai-core";

/**
 * Phase 19 — seeds the SYSTEM marketing context (ai/contexts/system.json) as version 1.
 * Production-safe and idempotent: if the SYSTEM context already exists nothing is changed
 * (later SYSTEM changes must be new versions, never overwrites).
 */
export function resolveSystemContextFile(): string | null {
  const candidates = [
    process.env.AI_SYSTEM_CONTEXT_FILE,
    path.resolve(__dirname, "../../../ai/contexts/system.json"),
    path.resolve(process.cwd(), "ai/contexts/system.json"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export async function seedSystemAiContext(db: PrismaClient): Promise<"created" | "exists" | "skipped"> {
  const file = resolveSystemContextFile();
  if (!file) {
    console.warn("[seed] ai/contexts/system.json not found; SYSTEM AI context not seeded.");
    return "skipped";
  }
  const spec = JSON.parse(fs.readFileSync(file, "utf8"));
  const key = typeof spec.key === "string" ? spec.key : "marketing";
  const existing = await db.aiContext.findFirst({ where: { scope: "SYSTEM", tenantId: null, key } });
  if (existing) return "exists";

  const content = normalizeContextContent(spec.content);
  await db.$transaction(async (tx) => {
    const ctx = await tx.aiContext.create({ data: { scope: "SYSTEM", tenantId: null, key, currentVersion: 1 } });
    await tx.aiContextVersion.create({
      data: {
        contextId: ctx.id,
        version: 1,
        content: content as any,
        contentHash: hashContextContent(content),
        changeReason: String(spec.changeReason || "Initial SYSTEM context"),
      },
    });
  });
  console.log("[seed] SYSTEM AI context seeded (version 1).");
  return "created";
}
