import { HttpException, HttpStatus } from "@nestjs/common";
import { InquiryRateLimiter } from "./inquiry-rate-limiter";

function makeLimiter(evalImpl: jest.Mock) {
  const config = { get: (_key: string, fallback?: string) => fallback };
  const limiter = new InquiryRateLimiter(config as any);
  // Replace the client: no network is touched, so the outcome is deterministic.
  (limiter as any).redis = { status: "ready", eval: evalImpl, quit: jest.fn() };
  return limiter;
}

async function statusOf(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : -1;
  }
}

describe("InquiryRateLimiter", () => {
  it("uses the documented defaults (5/IP, 3/email per hour)", () => {
    const limiter = makeLimiter(jest.fn());
    expect([limiter.perIpLimit, limiter.perEmailLimit, limiter.windowSeconds]).toEqual([5, 3, 3600]);
  });

  it("allows requests under the limit and checks IP then email", async () => {
    const evalMock = jest.fn().mockResolvedValue([1, 1]);
    const limiter = makeLimiter(evalMock);
    await expect(limiter.consumeForSubmission("iphash", "A@Example.com")).resolves.toBeUndefined();
    expect(evalMock).toHaveBeenCalledTimes(2);
    expect(evalMock.mock.calls[0][2]).toBe("ratelimit:service-inquiry:ip:iphash");
    // Email keys are hashed and case-insensitive: the raw address never reaches Redis.
    expect(evalMock.mock.calls[1][2]).toMatch(/^ratelimit:service-inquiry:email:[a-f0-9]{64}$/);
    expect(evalMock.mock.calls[1][2]).not.toContain("example.com");
  });

  it("returns 429 when the window is full", async () => {
    const limiter = makeLimiter(jest.fn().mockResolvedValue([0, 5]));
    expect(await statusOf(limiter.consumeForSubmission("iphash", "a@example.com"))).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it("stops at the per-IP check without touching the email bucket", async () => {
    const evalMock = jest.fn().mockResolvedValueOnce([0, 5]);
    const limiter = makeLimiter(evalMock);
    await statusOf(limiter.consumeForSubmission("iphash", "a@example.com"));
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 when Redis errors", async () => {
    const limiter = makeLimiter(jest.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await statusOf(limiter.consumeForSubmission("iphash", "a@example.com"))).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it("fails closed for per-account limits too (customer messages/uploads)", async () => {
    const limiter = makeLimiter(jest.fn().mockRejectedValue(new Error("timeout")));
    expect(await statusOf(limiter.consume({ key: "k", limit: 30, windowSeconds: 3600 }))).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
