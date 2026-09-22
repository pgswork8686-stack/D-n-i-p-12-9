export interface ReplayClaimResult {
  outcome: "claimed" | "duplicate";
}

/**
 * Atomically claims a replay-protection key in shared Redis.
 * Key: automation:hmac:replay:<service>:<requestId>, TTL 600000ms.
 * Uses SET key 1 NX PX 600000 (atomic). Throws on Redis failure so callers
 * can fail closed (503). Shared across all API instances/guards.
 */
export async function claimAutomationReplayKey(
  redisLike: { set: (...args: any[]) => Promise<any> },
  service: string,
  requestId: string,
  ttlMs = 600000,
): Promise<ReplayClaimResult> {
  const replayKey = `automation:hmac:replay:${service}:${requestId}`;
  const setResult = await redisLike.set(replayKey, "1", "PX", ttlMs, "NX");
  if (!setResult) {
    return { outcome: "duplicate" };
  }
  return { outcome: "claimed" };
}
