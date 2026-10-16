import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { QueryNotificationsDto } from "./tickets.dto";

describe("QueryNotificationsDto.isRead (query strings)", () => {
  const parse = async (raw: Record<string, unknown>) => {
    const dto = plainToInstance(QueryNotificationsDto, raw);
    return { dto, errors: await validate(dto) };
  };

  it('keeps "false" as false (was coerced to true, returning read notifications for ?isRead=false)', async () => {
    const { dto, errors } = await parse({ isRead: "false" });
    expect(errors).toEqual([]);
    expect(dto.isRead).toBe(false);
  });

  it('keeps "true" as true and leaves an omitted filter undefined', async () => {
    expect((await parse({ isRead: "true" })).dto.isRead).toBe(true);
    const omitted = await parse({});
    expect(omitted.errors).toEqual([]);
    expect(omitted.dto.isRead).toBeUndefined();
  });

  it("rejects values that are not a boolean literal", async () => {
    for (const bad of ["yes", "1", "0", "abc"]) {
      expect((await parse({ isRead: bad })).errors.map((e) => e.property)).toContain("isRead");
    }
  });
});
