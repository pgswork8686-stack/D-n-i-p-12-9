import { Test, TestingModule } from "@nestjs/testing";
import { AdminUsersController } from "./admin-users.controller";
import { UsersService } from "./users.service";
import { Reflector } from "@nestjs/core";
import { AuditService } from "../audit/audit.service";
import { AUTH_SERVICE } from "../auth/auth.constants";
import { DevMockAuthProvider } from "@nexus/auth";
import { Request } from "express";

describe("AdminUsersController", () => {
  let controller: AdminUsersController;
  let mockUsersService: any;

  beforeEach(async () => {
    mockUsersService = {
      listUsers: jest.fn().mockResolvedValue([{ id: "u1", email: "u1@test.com" }]),
      getUserById: jest.fn().mockResolvedValue({ id: "u1", email: "u1@test.com" }),
      listRoles: jest.fn().mockResolvedValue([{ id: "r1", name: "customer" }]),
      listPermissions: jest.fn().mockResolvedValue([{ id: "p1", name: "profile.read" }]),
      assignRole: jest.fn().mockResolvedValue({ id: "u1", roles: ["customer", "ops"] }),
      removeRole: jest.fn().mockResolvedValue({ id: "u1", roles: ["customer"] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: AUTH_SERVICE, useValue: new DevMockAuthProvider() },
        { provide: AuditService, useValue: { logAction: jest.fn() } },
        Reflector,
      ],
    }).compile();

    controller = module.get<AdminUsersController>(AdminUsersController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("lists all users", async () => {
    const result = await controller.listUsers();
    expect(result.status).toBe("ok");
    expect(result.count).toBe(1);
    expect(mockUsersService.listUsers).toHaveBeenCalled();
  });

  it("assigns a role via UsersService", async () => {
    const mockReq = {
      user: { id: "admin_1", roles: ["super_admin"] },
      ip: "127.0.0.1",
      headers: {},
    } as any as Request;

    const result = await controller.assignRole(mockReq, "u1", { role: "ops" });
    expect(result.status).toBe("ok");
    expect(mockUsersService.assignRole).toHaveBeenCalledWith(
      mockReq.user,
      "u1",
      "ops",
      expect.any(Object),
    );
  });
});