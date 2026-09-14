import { Test, TestingModule } from "@nestjs/testing";
import { EntitlementsController } from "./entitlements.controller";
import { AdminEntitlementsController } from "./admin-entitlements.controller";
import { EntitlementsService } from "./entitlements.service";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";

describe("EntitlementsControllers", () => {
  let customerController: EntitlementsController;
  let adminController: AdminEntitlementsController;
  let service: EntitlementsService;

  const mockService = {
    listUserEntitlements: jest.fn(),
    getUserEntitlement: jest.fn(),
    listAdminEntitlements: jest.fn(),
    getAdminEntitlement: jest.fn(),
    revokeEntitlement: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EntitlementsController, AdminEntitlementsController],
      providers: [
        {
          provide: EntitlementsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    customerController = module.get<EntitlementsController>(
      EntitlementsController,
    );
    adminController = module.get<AdminEntitlementsController>(
      AdminEntitlementsController,
    );
    service = module.get<EntitlementsService>(EntitlementsService);
  });

  describe("EntitlementsController (Customer)", () => {
    it("listUserEntitlements delegates to service with user.id", async () => {
      const mockResult = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      mockService.listUserEntitlements.mockResolvedValue(mockResult);

      const req = { user: { id: "cust-1" } };
      const query = { page: 1 };
      const result = await customerController.listUserEntitlements(req, query as any);

      expect(service.listUserEntitlements).toHaveBeenCalledWith("cust-1", query);
      expect(result).toEqual(mockResult);
    });

    it("getUserEntitlement delegates to service with user.id and id", async () => {
      const mockResult = { id: "ent-1", userId: "cust-1" };
      mockService.getUserEntitlement.mockResolvedValue(mockResult);

      const req = { user: { id: "cust-1" } };
      const result = await customerController.getUserEntitlement(req, "ent-1");

      expect(service.getUserEntitlement).toHaveBeenCalledWith("cust-1", "ent-1");
      expect(result).toEqual(mockResult);
    });
  });

  describe("AdminEntitlementsController", () => {
    it("listAdminEntitlements delegates to service", async () => {
      const mockResult = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      mockService.listAdminEntitlements.mockResolvedValue(mockResult);

      const query = { page: 1, userId: "cust-1" };
      const result = await adminController.listAdminEntitlements(query as any);

      expect(service.listAdminEntitlements).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockResult);
    });

    it("getAdminEntitlement delegates to service with id", async () => {
      const mockResult = { id: "ent-1" };
      mockService.getAdminEntitlement.mockResolvedValue(mockResult);

      const result = await adminController.getAdminEntitlement("ent-1");
      expect(service.getAdminEntitlement).toHaveBeenCalledWith("ent-1");
      expect(result).toEqual(mockResult);
    });

    it("revokeEntitlement delegates to service with actor id and reason", async () => {
      const mockResult = { id: "ent-1", status: "REVOKED" };
      mockService.revokeEntitlement.mockResolvedValue(mockResult);

      const req = { user: { id: "admin-1" } };
      const result = await adminController.revokeEntitlement(req, "ent-1", {
        reason: "Fraud",
      });

      expect(service.revokeEntitlement).toHaveBeenCalledWith(
        "ent-1",
        "admin-1",
        "Fraud",
      );
      expect(result).toEqual(mockResult);
    });
  });
});
