import { Test, TestingModule } from "@nestjs/testing";
import { LicensesService } from "./licenses.service";
import * as databaseModule from "@nexus/database";
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    listCustomerLicenses: jest.fn(),
    getCustomerLicense: jest.fn(),
    customerRevealLicenseKey: jest.fn(),
    activateInternalLicense: jest.fn(),
    validateInternalLicense: jest.fn(),
    deactivateInternalLicense: jest.fn(),
    adminListLicenses: jest.fn(),
    adminGetLicense: jest.fn(),
    adminRevokeLicense: jest.fn(),
  };
});

describe("LicensesService", () => {
  let service: LicensesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LicensesService],
    }).compile();

    service = module.get<LicensesService>(LicensesService);
    jest.clearAllMocks();
  });

  describe("listCustomerLicenses", () => {
    it("should return customer licenses", async () => {
      const mockLicenses = [
        {
          id: "lic-1",
          productId: "prod-1",
          variantId: "var-1",
          status: "ACTIVE" as const,
          keyMasked: "NXS-****-****-****-****-****-****-****-A1B2",
          maxActivations: 1,
          activeActivations: 0,
          expiresAt: null,
          updatesUntil: null,
          supportUntil: null,
          createdAt: new Date().toISOString(),
        },
      ];
      (databaseModule.listCustomerLicenses as jest.Mock).mockResolvedValue(
        mockLicenses,
      );

      const result = await service.listCustomerLicenses("user-1");
      expect(result).toEqual(mockLicenses);
      expect(databaseModule.listCustomerLicenses).toHaveBeenCalledWith("user-1");
    });
  });

  describe("getCustomerLicense", () => {
    it("should throw NotFoundException on 404 from domain engine", async () => {
      (databaseModule.getCustomerLicense as jest.Mock).mockRejectedValue(
        new databaseModule.InternalLicenseEngineError("License not found", 404),
      );

      await expect(
        service.getCustomerLicense("lic-999", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("customerRevealLicenseKey", () => {
    it("should return plaintext key to owner", async () => {
      const mockReveal = {
        licenseId: "lic-1",
        licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
        keyMasked: "NXS-****-****-****-****-****-****-****-8888",
      };
      (databaseModule.customerRevealLicenseKey as jest.Mock).mockResolvedValue(
        mockReveal,
      );

      const result = await service.customerRevealLicenseKey("lic-1", "user-1");
      expect(result).toEqual(mockReveal);
    });
  });

  describe("activateLicense", () => {
    it("should throw ConflictException on capacity limit (409)", async () => {
      (databaseModule.activateInternalLicense as jest.Mock).mockRejectedValue(
        new databaseModule.InternalLicenseEngineError("Capacity reached", 409),
      );

      await expect(
        service.activateLicense({
          licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
          domain: "example.com",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("validateLicense", () => {
    it("should return validation result", async () => {
      const mockResult = {
        valid: true,
        status: "ACTIVE" as const,
        domain: "example.com",
        expiresAt: null,
        updatesUntil: null,
        supportUntil: null,
      };
      (databaseModule.validateInternalLicense as jest.Mock).mockResolvedValue(
        mockResult,
      );

      const result = await service.validateLicense({
        licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
        domain: "example.com",
      });
      expect(result).toEqual(mockResult);
    });
  });
});
