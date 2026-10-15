import { Prisma } from "@nexus/database";
import { isUniqueViolationOn, withUniqueCodeRetry } from "./unique-code";

const p2002 = (target: unknown) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "x", meta: { target } });

describe("unique code retry", () => {
  it("recognises violations on the code column, by column or field name", () => {
    expect(isUniqueViolationOn(p2002(["inquiry_number"]), "inquiry_number", "inquiryNumber")).toBe(true);
    expect(isUniqueViolationOn(p2002(["inquiryNumber"]), "inquiry_number", "inquiryNumber")).toBe(true);
    expect(isUniqueViolationOn(p2002("service_inquiries_inquiry_number_key"), "inquiry_number", "inquiryNumber")).toBe(true);
    expect(isUniqueViolationOn(p2002(["submission_key"]), "inquiry_number", "inquiryNumber")).toBe(false);
    expect(isUniqueViolationOn(new Error("x"), "inquiry_number", "inquiryNumber")).toBe(false);
  });

  it("retries a code collision with a fresh attempt and returns the result", async () => {
    const run = jest.fn().mockRejectedValueOnce(p2002(["project_code"])).mockResolvedValueOnce("ok");
    await expect(withUniqueCodeRetry("project_code", "projectCode", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry other unique violations (e.g. idempotency keys)", async () => {
    const err = p2002(["submission_key"]);
    const run = jest.fn().mockRejectedValue(err);
    await expect(withUniqueCodeRetry("inquiry_number", "inquiryNumber", run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit", async () => {
    const run = jest.fn().mockRejectedValue(p2002(["inquiry_number"]));
    await expect(withUniqueCodeRetry("inquiry_number", "inquiryNumber", run, 3)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(run).toHaveBeenCalledTimes(3);
  });
});
