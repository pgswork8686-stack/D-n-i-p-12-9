import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";
import { AuditService } from "../audit/audit.service";

describe("PermissionsGuard", () => {
  let guard: PermissionsGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockAuditService: jest.Mocked<AuditService>;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    mockAuditService = {
      logAction: jest.fn(),
    } as any;

    guard = new PermissionsGuard(mockReflector, mockAuditService);
  });

  function createMockContext(user?: any, path = "/test"): ExecutionContext {
    const req: any = { user, path, method: "GET", ip: "127.0.0.1", headers: {} };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as any;
  }

  it("allows access when route requires no permissions", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext();

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it("throws 401 when user is missing but permissions are required", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(["user.read"]);
    const context = createMockContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("allows access to super_admin unconditionally", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(["settings.manage", "system.root"]);
    const context = createMockContext({
      id: "usr_super",
      roles: ["super_admin"],
      permissions: [],
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it("allows access when user has all required permissions", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(["product.read", "product.write"]);
    const context = createMockContext({
      id: "usr_editor",
      roles: ["content_editor"],
      permissions: ["product.read", "product.write", "other.perm"],
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it("throws 403 and records audit log when user lacks required permission", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(["user.manage"]);
    const context = createMockContext({
      id: "usr_cust",
      roles: ["customer"],
      permissions: ["profile.read"],
    }, "/admin/users");

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException("Forbidden: Insufficient permissions to access this resource"),
    );

    expect(mockAuditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AUTHORIZATION_DENIED",
        entity: "Route",
        actorId: "usr_cust",
      }),
    );
  });
});