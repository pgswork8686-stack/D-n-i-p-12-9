import { Test, TestingModule } from "@nestjs/testing";
import { AllocationsController } from "./allocations.controller";
import { AdminAllocationsController } from "./admin-allocations.controller";
import { AllocationsService } from "./allocations.service";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";

describe("Allocations Controllers", () => {
  let customerController: AllocationsController;
  let adminController: AdminAllocationsController;
  let service: jest.Mocked<AllocationsService>;

  beforeEach(async () => {
    service = {
      requestAllocation: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
      listCustomerAllocations: jest.fn().mockResolvedValue([{ id: "alloc-1" }] as any),
      customerRequestDeactivation: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
      adminListProviders: jest.fn().mockResolvedValue([{ id: "prov-1" }] as any),
      adminListProviderAccounts: jest.fn().mockResolvedValue([{ id: "pa-1" }] as any),
      adminCreateProviderAccount: jest.fn().mockResolvedValue({ id: "pa-1" } as any),
      adminGetProviderAccount: jest.fn().mockResolvedValue({ id: "pa-1" } as any),
      adminUpdateProviderAccount: jest.fn().mockResolvedValue({ id: "pa-1" } as any),
      adminListAllocations: jest.fn().mockResolvedValue({ items: [], total: 0 } as any),
      adminGetAllocation: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
      adminActivateAllocation: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
      adminRejectAllocation: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
      adminRequestDeactivation: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
      adminConfirmDeactivated: jest.fn().mockResolvedValue({ id: "alloc-1" } as any),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AllocationsController, AdminAllocationsController],
      providers: [{ provide: AllocationsService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    customerController = module.get<AllocationsController>(AllocationsController);
    adminController = module.get<AdminAllocationsController>(AdminAllocationsController);
  });

  it("customerController.requestAllocation delegates to service", async () => {
    const req = { user: { id: "user-1" } };
    const result = await customerController.requestAllocation(
      req,
      "ent-1",
      { domain: "example.com" },
    );
    expect(service.requestAllocation).toHaveBeenCalledWith(
      "ent-1",
      "user-1",
      { domain: "example.com" },
    );
    expect(result).toEqual({ id: "alloc-1" });
  });

  it("adminController.activateAllocation delegates to service", async () => {
    const req = { user: { id: "admin-1" } };
    const result = await adminController.activateAllocation(
      req,
      "alloc-1",
      { providerAccountId: "pa-1", notes: "ok" },
    );
    expect(service.adminActivateAllocation).toHaveBeenCalledWith(
      "alloc-1",
      { providerAccountId: "pa-1", notes: "ok" },
      "admin-1",
    );
    expect(result).toEqual({ id: "alloc-1" });
  });
});
