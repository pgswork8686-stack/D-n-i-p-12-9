import { seedDevUsers } from "@nexus/database";

describe("Database Seed Isolation (B01)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("strictly skips dev users when NODE_ENV === 'production'", async () => {
    process.env.NODE_ENV = "production";
    process.env.SEED_DEV_USERS = "true";

    const mockPrisma: any = {
      user: { upsert: jest.fn() },
      profile: { upsert: jest.fn() },
      userRole: { upsert: jest.fn() },
    };

    const rolesMap = new Map([["admin", "r1"]]);
    await seedDevUsers(mockPrisma, rolesMap);

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("skips dev users when SEED_DEV_USERS is not 'true'", async () => {
    process.env.NODE_ENV = "development";
    process.env.SEED_DEV_USERS = "false";

    const mockPrisma: any = {
      user: { upsert: jest.fn() },
      profile: { upsert: jest.fn() },
      userRole: { upsert: jest.fn() },
    };

    const rolesMap = new Map([["admin", "r1"]]);
    await seedDevUsers(mockPrisma, rolesMap);

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("seeds dev users when in non-production AND SEED_DEV_USERS === 'true'", async () => {
    process.env.NODE_ENV = "development";
    process.env.SEED_DEV_USERS = "true";

    const mockPrisma: any = {
      user: { upsert: jest.fn().mockResolvedValue({ id: "u1" }) },
      profile: { upsert: jest.fn().mockResolvedValue({}) },
      userRole: { upsert: jest.fn().mockResolvedValue({}) },
    };

    const rolesMap = new Map([
      ["admin", "r_admin"],
      ["customer", "r_cust"],
      ["super_admin", "r_super"],
    ]);

    await seedDevUsers(mockPrisma, rolesMap);

    expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.userRole.upsert).toHaveBeenCalledTimes(3);
  });
});
