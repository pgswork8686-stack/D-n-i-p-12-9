import { HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UploadQuota, UploadQuotaGuard, UPLOAD_QUOTA_KEY } from "./upload-quota.guard";
import { MyServiceProjectsController, PublicServiceInquiriesController } from "./services.controllers";

class Fixture {
  @UploadQuota({ scope: "inquiry", limitEnv: "TEST_UPLOAD_LIMIT", defaultLimit: 10 })
  handler() {}
  plain() {}
}

function makeGuard(env: Record<string, string> = {}, consume = jest.fn().mockResolvedValue(undefined)) {
  const config = { get: (k: string) => env[k] };
  const guard = new UploadQuotaGuard(new Reflector(), { consume } as any, config as any);
  return { guard, consume };
}

const ctx = (handler: () => void, req: Record<string, unknown>) =>
  ({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) }) as any;

const multipart = { "content-type": "multipart/form-data; boundary=x" };

describe("UploadQuotaGuard", () => {
  it("consumes the per-account quota for signed-in multipart requests, before the body is parsed", async () => {
    const { guard, consume } = makeGuard();
    await expect(guard.canActivate(ctx(Fixture.prototype.handler, { headers: multipart, user: { id: "u1" } }))).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith({ key: "ratelimit:service-upload:inquiry:u1", limit: 10, windowSeconds: 3600 });
  });

  it("honours the configured limit", async () => {
    const { guard, consume } = makeGuard({ TEST_UPLOAD_LIMIT: "3" });
    await guard.canActivate(ctx(Fixture.prototype.handler, { headers: multipart, user: { id: "u1" } }));
    expect(consume.mock.calls[0][0].limit).toBe(3);
  });

  it("ignores invalid configured limits", async () => {
    const { guard, consume } = makeGuard({ TEST_UPLOAD_LIMIT: "abc" });
    await guard.canActivate(ctx(Fixture.prototype.handler, { headers: multipart, user: { id: "u1" } }));
    expect(consume.mock.calls[0][0].limit).toBe(10);
  });

  it("skips anonymous requests (their file parts are refused by the Multer fileFilter)", async () => {
    const { guard, consume } = makeGuard();
    await expect(guard.canActivate(ctx(Fixture.prototype.handler, { headers: multipart }))).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it("skips non-multipart requests and handlers without a quota", async () => {
    const { guard, consume } = makeGuard();
    await guard.canActivate(ctx(Fixture.prototype.handler, { headers: { "content-type": "application/json" }, user: { id: "u1" } }));
    await guard.canActivate(ctx(Fixture.prototype.plain, { headers: multipart, user: { id: "u1" } }));
    expect(consume).not.toHaveBeenCalled();
  });

  it("propagates 429 and the fail-closed 503 from the limiter", async () => {
    for (const status of [HttpStatus.TOO_MANY_REQUESTS, HttpStatus.SERVICE_UNAVAILABLE]) {
      const { guard } = makeGuard({}, jest.fn().mockRejectedValue(new HttpException("x", status)));
      await expect(guard.canActivate(ctx(Fixture.prototype.handler, { headers: multipart, user: { id: "u1" } }))).rejects.toMatchObject({
        status,
      });
    }
  });

  it("is wired on the customer upload routes", () => {
    expect(Reflect.getMetadata(UPLOAD_QUOTA_KEY, PublicServiceInquiriesController.prototype.submit)).toMatchObject({ scope: "inquiry" });
    expect(Reflect.getMetadata(UPLOAD_QUOTA_KEY, MyServiceProjectsController.prototype.uploadDocument)).toMatchObject({
      scope: "project-document",
    });
  });
});
