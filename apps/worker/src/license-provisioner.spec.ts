import {
  provisionInternalLicenses,
  reconcileInternalLicenses,
} from "./license-provisioner";
import * as dbModule from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {},
    provisionInternalLicenses: jest.fn(),
    reconcileInternalLicenses: jest.fn(),
  };
});

describe("License Provisioner Worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("provisionInternalLicenses", () => {
    it("should call engine provision with default parameters", async () => {
      (dbModule.provisionInternalLicenses as jest.Mock).mockResolvedValue({
        provisionedCount: 2,
        licenseIds: ["lic-1", "lic-2"],
      });

      const result = await provisionInternalLicenses();
      expect(result.provisionedCount).toBe(2);
      expect(dbModule.provisionInternalLicenses).toHaveBeenCalledWith(
        { batchSize: 100, workerId: "worker-default" },
        expect.anything(),
      );
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
