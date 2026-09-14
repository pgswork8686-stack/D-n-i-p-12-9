import { Test, TestingModule } from "@nestjs/testing";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";
import { AuthGuard } from "../auth/auth.guard";

describe("LicensesController", () => {
  let controller: LicensesController;
  let service: LicensesService;

  const mockLicensesService = {
    listCustomerLicenses: jest.fn(),
    getCustomerLicense: jest.fn(),
    customerRevealLicenseKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        {
          provide: LicensesService,
          useValue: mockLicensesService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LicensesController>(LicensesController);
    service = module.get<LicensesService>(LicensesService);
    jest.clearAllMocks();
  });

  it("should list licenses for authenticated user", async () => {
    mockLicensesService.listCustomerLicenses.mockResolvedValue([]);
    const req = { user: { id: "user-1" } };
    const res = await controller.listCustomerLicenses(req);
    expect(res).toEqual([]);
    expect(mockLicensesService.listCustomerLicenses).toHaveBeenCalledWith("user-1");
  });

  it("should reveal license key strictly for owner", async () => {
    const mockReveal = {
      licenseId: "lic-1",
      licenseKey: "NXS-1234-5678-ABCD-EF01",
      keyMasked: "NXS-****-****-****-EF01",
    };
    mockLicensesService.customerRevealLicenseKey.mockResolvedValue(mockReveal);
    const req = { user: { id: "user-1" } };
    const res = await controller.revealLicense(req, "lic-1");
    expect(res).toEqual(mockReveal);
    expect(mockLicensesService.customerRevealLicenseKey).toHaveBeenCalledWith(
      "lic-1",
      "user-1",
    );
  });
});
