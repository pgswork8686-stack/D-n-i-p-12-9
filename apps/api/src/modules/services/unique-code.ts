import { Prisma } from "@nexus/database";

/** True when `err` is a unique-constraint violation on the given column (Prisma P2002). */
export function isUniqueViolationOn(err: unknown, column: string, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const names = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return names.some((n) => n === column || n === field || n.includes(column));
}

/**
 * Human-readable codes (SI-/PRJ-YYYYMM-XXXXXX) carry 24 random bits per month, so a
 * collision is unlikely but possible under load. `run` must generate a fresh code on
 * every call; it is retried only when the violation is on that code's column.
 */
export async function withUniqueCodeRetry<T>(
  column: string,
  field: string,
  run: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= attempts || !isUniqueViolationOn(err, column, field)) throw err;
    }
  }
}
