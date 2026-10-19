import "reflect-metadata";
import { ExecutionContext, PayloadTooLargeException } from "@nestjs/common";
import {
  AdminServiceProjectsController,
  INQUIRY_MAX_REQUEST_BYTES,
  MyServiceProjectsController,
  PublicServiceInquiriesController,
  SINGLE_FILE_MAX_REQUEST_BYTES,
} from "./services.controllers";
import { UploadQuotaGuard } from "./upload-quota.guard";

const MB = 1024 * 1024;
const ctx = (len: number) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: { "content-length": String(len) } }) }) }) as unknown as ExecutionContext;

/** Method-level guards declared on a handler (class-level guards are separate metadata). */
const methodGuards = (proto: object, name: string): any[] => Reflect.getMetadata("__guards__", (proto as any)[name]) ?? [];

/** Size guards only: the per-account UploadQuotaGuard is covered by upload-quota.guard.spec.ts. */
const sizeGuards = (proto: object, name: string): any[] => methodGuards(proto, name).filter((G) => G !== UploadQuotaGuard);

/** Runs every method-level size guard against a request of `len` bytes. */
const run = (proto: object, name: string, len: number) => {
  for (const G of sizeGuards(proto, name)) new G().canActivate(ctx(len));
};

describe("services upload endpoints: per-endpoint request-size limits (F-08)", () => {
  it("derives the limits from the file rules: 5 x 10 MB + 2 MB for the form, 10 MB + 2 MB for one file", () => {
    expect(INQUIRY_MAX_REQUEST_BYTES).toBe(52 * MB);
    expect(SINGLE_FILE_MAX_REQUEST_BYTES).toBe(12 * MB);
  });

  it("guards the public inquiry form", () => {
    const proto = PublicServiceInquiriesController.prototype;
    expect(sizeGuards(proto, "submit")).toHaveLength(1);
    // The size ceiling runs before the per-account quota, so oversized bodies spend no quota.
    expect(methodGuards(proto, "submit")).toEqual([sizeGuards(proto, "submit")[0], UploadQuotaGuard]);
    expect(() => run(proto, "submit", 52 * MB)).not.toThrow();
    expect(() => run(proto, "submit", 52 * MB + 1)).toThrow(PayloadTooLargeException);
  });

  it("guards the customer and staff document uploads with the single-file limit", () => {
    for (const proto of [MyServiceProjectsController.prototype, AdminServiceProjectsController.prototype]) {
      expect(sizeGuards(proto, "uploadDocument")).toHaveLength(1);
      expect(() => run(proto, "uploadDocument", 12 * MB)).not.toThrow();
      expect(() => run(proto, "uploadDocument", 13 * MB)).toThrow(PayloadTooLargeException);
    }
  });

  it("applies the per-account upload quota to customer uploads only (staff uploads are trusted)", () => {
    expect(methodGuards(MyServiceProjectsController.prototype, "uploadDocument")).toContain(UploadQuotaGuard);
    expect(methodGuards(AdminServiceProjectsController.prototype, "uploadDocument")).not.toContain(UploadQuotaGuard);
  });

  it("a request sized for the public form is far too large for a document upload", () => {
    expect(() => run(MyServiceProjectsController.prototype, "uploadDocument", 52 * MB)).toThrow(PayloadTooLargeException);
  });
});
