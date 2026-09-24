import {
  provisionInternalLicenses,
  reconcileInternalLicenses,
  reconcileMissingLicenseProvisionedEmailJobs,
} from "./license-provisioner";
import * as dbModule from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $queryRaw: jest.fn(),
      internalLicense: { findMany: jest.fn() },
      automationJob: { findMany: jest.fn() },
    },
    provisionInternalLicenses: jest.fn(),
    reconcileInternalLicenses: jest.fn(),
    enqueueLicenseProvisionedEmailJob: jest.fn(),
  };
});

describe("License Provisioner Worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("provisionInternalLicenses", () => {
    it("should call engine provision and enqueue notification jobs for created licenses", async () => {
      (dbModule.provisionInternalLicenses as jest.Mock).mockResolvedValue({
        provisionedCount: 2,
        licenseIds: ["lic-1", "lic-2"],
      });
      (dbModule.enqueueLicenseProvisionedEmailJob as jest.Mock).mockResolvedValue({ id: "job-1" });

      const result = await provisionInternalLicenses();
      expect(result.provisionedCount).toBe(2);
      expect(dbModule.provisionInternalLicenses).toHaveBeenCalledWith(
        { batchSize: 100, workerId: "worker-default" },
        expect.anything(),
      );
      expect(dbModule.enqueueLicenseProvisionedEmailJob).toHaveBeenCalledWith("lic-1", expect.anything());
      expect(dbModule.enqueueLicenseProvisionedEmailJob).toHaveBeenCalledWith("lic-2", expect.anything());
    });

    it("should rethrow on engine failure", async () => {
      (dbModule.provisionInternalLicenses as jest.Mock).mockRejectedValue(
        new Error("DB connection failure"),
      );

      await expect(provisionInternalLicenses()).rejects.toThrow(
        "DB connection failure",
      );
    });
  });

  describe("reconcileMissingLicenseProvisionedEmailJobs", () => {
    it("should find active licenses without notification jobs and enqueue them", async () => {
      (dbModule.prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "lic-missing-1" }, { id: "lic-missing-2" }]);
      (dbModule.enqueueLicenseProvisionedEmailJob as jest.Mock).mockResolvedValue({ id: "job-recovered" });

      const result = await reconcileMissingLicenseProvisionedEmailJobs({
        workerId: "worker-test",
        batchSize: 50,
      });

      expect(result.enqueuedCount).toBe(2);
      expect(dbModule.enqueueLicenseProvisionedEmailJob).toHaveBeenCalledWith("lic-missing-1", expect.anything());
      expect(dbModule.enqueueLicenseProvisionedEmailJob).toHaveBeenCalledWith("lic-missing-2", expect.anything());
    });
  });

  describe("reconcileInternalLicenses", () => {
    it("should call engine reconcile with provided parameters", async () => {
      (dbModule.reconcileInternalLicenses as jest.Mock).mockResolvedValue({
        reconciledCount: 1,
        licenseIds: ["lic-1"],
      });

      const result = await reconcileInternalLicenses({
        workerId: "worker-custom",
        batchSize: 50,
      });
      expect(result.reconciledCount).toBe(1);
      expect(dbModule.reconcileInternalLicenses).toHaveBeenCalledWith(
        { batchSize: 50, workerId: "worker-custom" },
        expect.anything(),
      );
    });
  });
});
