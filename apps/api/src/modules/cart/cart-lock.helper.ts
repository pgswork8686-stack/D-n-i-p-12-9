import { InternalServerErrorException } from "@nestjs/common";
import { Cart } from "@nexus/database";

/**
 * Acquires an exclusive row-level lock (SELECT ... FOR UPDATE) on a specific Cart row by ID.
 *
 * In runtime (development, staging, production):
 *  - Must execute `SELECT * FROM "carts" WHERE "id" = $1 FOR UPDATE` via `tx.$queryRaw`.
 *  - If the query fails or raw query is not supported, FAILS CLOSED (rethrows error).
 *  - Never silently downgrades to non-locking queries.
 *
 * In test environment (`NODE_ENV === "test"`):
 *  - Supports mocked Prisma clients where `$queryRaw` may be absent or mocked.
 */
export async function lockCartById(
  tx: any,
  cartId: string,
): Promise<Cart | null> {
  const isTest = process.env.NODE_ENV === "test";

  if (typeof tx?.$queryRaw === "function") {
    try {
      const rows = await tx.$queryRaw<Cart[]>`
        SELECT * FROM "carts" WHERE "id" = ${cartId} FOR UPDATE
      `;
      return rows?.[0] || null;
    } catch (err) {
      if (isTest) {
        return tx.cart.findUnique({ where: { id: cartId } });
      }
      // Fail closed in dev, staging, prod
      throw err;
    }
  }

  if (isTest) {
    return tx.cart.findUnique({ where: { id: cartId } });
  }

  throw new InternalServerErrorException(
    "Database transaction client does not support row-level locking ($queryRaw missing)",
  );
}

/**
 * Acquires an exclusive row-level lock (SELECT ... FOR UPDATE) on a user's active Cart row.
 *
 * In runtime (development, staging, production):
 *  - Must execute `SELECT * FROM "carts" WHERE "user_id" = $1 AND "status" = 'ACTIVE' LIMIT 1 FOR UPDATE` via `tx.$queryRaw`.
 *  - If the query fails or raw query is not supported, FAILS CLOSED (rethrows error).
 *  - Never silently downgrades to non-locking queries.
 *
 * In test environment (`NODE_ENV === "test"`):
 *  - Supports mocked Prisma clients where `$queryRaw` may be absent or mocked.
 */
export async function lockActiveCartByUser(
  tx: any,
  userId: string,
): Promise<Cart | null> {
  const isTest = process.env.NODE_ENV === "test";

  if (typeof tx?.$queryRaw === "function") {
    try {
      const rows = await tx.$queryRaw<Cart[]>`
        SELECT * FROM "carts" WHERE "user_id" = ${userId} AND "status" = 'ACTIVE' LIMIT 1 FOR UPDATE
      `;
      return rows?.[0] || null;
    } catch (err) {
      if (isTest) {
        return tx.cart.findFirst({ where: { userId, status: "ACTIVE" } });
      }
      // Fail closed in dev, staging, prod
      throw err;
    }
  }

  if (isTest) {
    return tx.cart.findFirst({ where: { userId, status: "ACTIVE" } });
  }

  throw new InternalServerErrorException(
    "Database transaction client does not support row-level locking ($queryRaw missing)",
  );
}
