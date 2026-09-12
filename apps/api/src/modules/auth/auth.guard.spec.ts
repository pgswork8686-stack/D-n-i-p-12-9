import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { IAuthService } from "@nexus/auth";
import { UsersService } from "../users/users.service";

describe("AuthGuard", () => {
  let guard: AuthGuard;
  let mockAuthService: jest.Mocked<IAuthService>;
  let mockUsersService: Partial<UsersService>;

  beforeEach(() => {
    mockAuthService = {
      verifyToken: jest.fn(),
    } as any;

    mockUsersService = {
      getOrProvisionUser: jest.fn(),
    };

    guard = new AuthGuard(mockAuthService, mockUsersService as UsersService);
  });

  function createMockContext(headers: Record<string, string>): ExecutionContext {
    const req: any = { headers, ip: "127.0.0.1" };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as any;
  }

  it("throws 401 when Authorization header is missing", async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException("Missing or invalid authorization header"),
    );
  });

  it("throws 401 when Authorization header does not start with Bearer", async () => {
    const context = createMockContext({ authorization: "Basic 12345" });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException("Missing or invalid authorization header"),
    );
  });

  it("throws 401 when token is invalid or expired", async () => {
    mockAuthService.verifyToken.mockResolvedValue(null);
    const context = createMockContext({ authorization: "Bearer bad-token" });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException("Invalid or expired session token"),
    );
  });

  it("provisions user and attaches to request when token is valid", async () => {
    const identity = { subject: "sub_123", email: "test@example.com" };
    const authUser = {
      id: "usr_123",
      email: "test@example.com",
      roles: ["customer"],
      permissions: ["profile.read"],
    };

    mockAuthService.verifyToken.mockResolvedValue(identity);
    (mockUsersService.getOrProvisionUser as jest.Mock).mockResolvedValue(authUser);

    const context = createMockContext({ authorization: "Bearer valid-token" });
    const req = context.switchToHttp().getRequest();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req.user).toEqual(authUser);
    expect(mockAuthService.verifyToken).toHaveBeenCalledWith("valid-token");
    expect(mockUsersService.getOrProvisionUser).toHaveBeenCalledWith(identity, {
      ipAddress: "127.0.0.1",
      userAgent: undefined,
    });
  });
});