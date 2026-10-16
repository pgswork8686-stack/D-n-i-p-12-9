import { ExecutionContext, PayloadTooLargeException } from "@nestjs/common";
import { maxRequestBytes } from "./max-request-bytes.guard";

const ctx = (headers: Record<string, string | string[] | undefined>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

const MB = 1024 * 1024;

describe("maxRequestBytes", () => {
  const Guard = maxRequestBytes(11 * MB);
  const guard = new Guard();

  it("allows bodies at or under the limit", () => {
    expect(guard.canActivate(ctx({ "content-length": String(11 * MB) }))).toBe(true);
    expect(guard.canActivate(ctx({ "content-length": "0" }))).toBe(true);
  });

  it("rejects an oversized declared body with 413 before the body is read", () => {
    expect(() => guard.canActivate(ctx({ "content-length": String(11 * MB + 1) }))).toThrow(PayloadTooLargeException);
    expect(() => guard.canActivate(ctx({ "content-length": String(500 * MB) }))).toThrow(PayloadTooLargeException);
  });

  it("leaves chunked or unparsable lengths to the Multer limits instead of guessing", () => {
    expect(guard.canActivate(ctx({}))).toBe(true);
    expect(guard.canActivate(ctx({ "content-length": "abc" }))).toBe(true);
    expect(guard.canActivate(ctx({ "content-length": "-5" }))).toBe(true);
  });

  it("uses the first value when the header is repeated", () => {
    expect(() => guard.canActivate(ctx({ "content-length": [String(12 * MB), "1"] }))).toThrow(PayloadTooLargeException);
  });

  it("gives each endpoint its own limit", () => {
    const small = new (maxRequestBytes(1 * MB))();
    expect(() => small.canActivate(ctx({ "content-length": String(2 * MB) }))).toThrow(PayloadTooLargeException);
    expect(guard.canActivate(ctx({ "content-length": String(2 * MB) }))).toBe(true);
  });

  it("refuses a nonsensical limit at definition time", () => {
    expect(() => maxRequestBytes(0)).toThrow();
    expect(() => maxRequestBytes(1.5)).toThrow();
  });
});
