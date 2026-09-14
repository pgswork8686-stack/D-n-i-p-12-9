import { Test, TestingModule } from "@nestjs/testing";
import { PublicLicensesController } from "./public-licenses.controller";
import { LicensesService } from "./licenses.service";

describe("PublicLicensesController", () => {
  let controller: PublicLicensesController;
  let service: LicensesService;

  const mockLicensesService = {
    activateLicense: jest.fn(),
    validateLicense: jest.fn(),
    deactivateLicense: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicLicensesController],
      providers: [
        {
          provide: LicensesService,
          useValue: mockLicensesService,
        },
      ],
    }).compile();

    controller = module.get<PublicLicensesController>(PublicLicensesController);
    service = module.get<LicensesService>(LicensesService);
    jest.clearAllMocks();
  });

  it("should handle activation request", async () => {
    const mockResponse = {
      valid: true,
      status: "ACTIVE" as const,
      domain: "example.com",
      activatedAt: new Date().toISOString(),
      expiresAt: null,
      updatesUntil: null,
      supportUntil: null,
    };
    mockLicensesService.activateLicense.mockResolvedValue(mockResponse);

    const dto = {
      licenseKey: "NXS-1111-2222-3333-4444",
      domain: "https://example.com/path",
    };
    const res = await controller.activateLicense(dto);
    expect(res).toEqual(mockResponse);
    expect(mockLicensesService.activateLicense).toHaveBeenCalledWith(dto);
  });

  it("should handle validation request", async () => {
    const mockResponse = {
      valid: true,
      status: "ACTIVE" as const,
      domain: "example.com",
      expiresAt: null,
      updatesUntil: null,
      supportUntil: null,
    };
    mockLicensesService.validateLicense.mockResolvedValue(mockResponse);

    const dto = {
      licenseKey: "NXS-1111-2222-3333-4444",
      domain: "example.com",
    };
    const res = await controller.validateLicense(dto);
    expect(res).toEqual(mockResponse);
  });

  it("should handle deactivation request", async () => {
    const mockResponse = {
      success: true,
      domain: "example.com",
      deactivatedAt: new Date().toISOString(),
    };
    mockLicensesService.deactivateLicense.mockResolvedValue(mockResponse);

    const dto = {
      licenseKey: "NXS-1111-2222-3333-4444",
      domain: "example.com",
    };
    const res = await controller.deactivateLicense(dto);
    expect(res).toEqual(mockResponse);
  });
});
