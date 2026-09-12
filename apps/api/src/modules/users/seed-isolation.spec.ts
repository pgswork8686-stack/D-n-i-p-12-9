import { seedDevUsers, seedSystemRbac } from "@nexus/database";

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

describe("Deterministic System RBAC Seed Revoke (H01)", () => {
  it("deletes stale rolePermission records when a permission is removed from role map", async () => {
    const mockPrisma: any = {
      role: {
        upsert: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: `id_${where.name}`, name: where.name }),
        ),
      },
      permission: {
        upsert: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: `id_${where.name}`, name: where.name }),
        ),
      },
      rolePermission: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    // Simulate role map with only 'profile.read' for customer (revoking previously assigned perms)
    const customMap: Record<string, string[]> = {
      customer: ["profile.read"],
    };

    await seedSystemRbac(mockPrisma, customMap);

    // Verify deleteMany was called to revoke any permissions not in ['id_profile.read']
    expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        roleId: "id_customer",
        permissionId: {
          notIn: ["id_profile.read"],
        },
      },
    });

    // Verify upsert was called for the desired permission
    expect(mockPrisma.rolePermission.upsert).toHaveBeenCalledWith({
      where: {
        roleId_permissionId: {
          roleId: "id_customer",
          permissionId: "id_profile.read",
        },
      },
      update: {},
      create: {
        roleId: "id_customer",
        permissionId: "id_profile.read",
      },
    });
  });

  it("deletes all role permissions when desired permission list is empty", async () => {
    const mockPrisma: any = {
      role: {
        upsert: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: `id_${where.name}`, name: where.name }),
        ),
      },
      permission: {
        upsert: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: `id_${where.name}`, name: where.name }),
        ),
      },
      rolePermission: {
        deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const emptyMap: Record<string, string[]> = {
      customer: [],
    };

    await seedSystemRbac(mockPrisma, emptyMap);

    expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        roleId: "id_customer",
      },
    });
    expect(mockPrisma.rolePermission.upsert).not.toHaveBeenCalled();
  });
});

