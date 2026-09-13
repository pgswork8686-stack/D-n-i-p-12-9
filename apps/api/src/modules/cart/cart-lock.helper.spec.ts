import { InternalServerErrorException } from "@nestjs/common";
import { lockCartById, lockActiveCartByUser } from "./cart-lock.helper";

describe("CartLockHelper", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.clearAllMocks();
  });

  describe("lockCartById", () => {
    it("returns locked cart row when $queryRaw succeeds", async () => {
      const mockCart = { id: "cart-1", status: "ACTIVE", currency: "USD" };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([mockCart]),
      };

      const result = await lockCartById(tx, "cart-1");
      expect(result).toEqual(mockCart);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("falls back to findUnique when in test environment and $queryRaw is missing", async () => {
      process.env.NODE_ENV = "test";
      const mockCart = { id: "cart-1", status: "ACTIVE", currency: "USD" };
      const tx = {
        cart: {
          findUnique: jest.fn().mockResolvedValue(mockCart),
        },
      };

      const result = await lockCartById(tx, "cart-1");
      expect(result).toEqual(mockCart);
      expect(tx.cart.findUnique).toHaveBeenCalledWith({
        where: { id: "cart-1" },
      });
    });

    it("falls back to findUnique when in test environment and $queryRaw fails", async () => {
      process.env.NODE_ENV = "test";
      const mockCart = { id: "cart-1", status: "ACTIVE", currency: "USD" };
      const tx = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("Raw query failed")),
        cart: {
          findUnique: jest.fn().mockResolvedValue(mockCart),
        },
      };

      const result = await lockCartById(tx, "cart-1");
      expect(result).toEqual(mockCart);
      expect(tx.cart.findUnique).toHaveBeenCalledWith({
        where: { id: "cart-1" },
      });
    });

    it("FAILS CLOSED (throws error) in production when $queryRaw throws", async () => {
      process.env.NODE_ENV = "production";
      const tx = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("Deadlock detected")),
        cart: {
          findUnique: jest.fn().mockResolvedValue({ id: "cart-1" }),
        },
      };

      await expect(lockCartById(tx, "cart-1")).rejects.toThrow(
        "Deadlock detected",
      );
      expect(tx.cart.findUnique).not.toHaveBeenCalled();
    });

    it("FAILS CLOSED in production when $queryRaw is missing", async () => {
      process.env.NODE_ENV = "production";
      const tx = {
        cart: {
          findUnique: jest.fn().mockResolvedValue({ id: "cart-1" }),
        },
      };

      await expect(lockCartById(tx, "cart-1")).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(tx.cart.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("lockActiveCartByUser", () => {
    it("returns locked active cart row when $queryRaw succeeds", async () => {
      const mockCart = { id: "cart-1", userId: "user-1", status: "ACTIVE" };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([mockCart]),
      };

      const result = await lockActiveCartByUser(tx, "user-1");
      expect(result).toEqual(mockCart);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("falls back to findFirst when in test environment and $queryRaw is missing", async () => {
      process.env.NODE_ENV = "test";
      const mockCart = { id: "cart-1", userId: "user-1", status: "ACTIVE" };
      const tx = {
        cart: {
          findFirst: jest.fn().mockResolvedValue(mockCart),
        },
      };

      const result = await lockActiveCartByUser(tx, "user-1");
      expect(result).toEqual(mockCart);
      expect(tx.cart.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", status: "ACTIVE" },
      });
    });

    it("falls back to findFirst when in test environment and $queryRaw fails", async () => {
      process.env.NODE_ENV = "test";
      const mockCart = { id: "cart-1", userId: "user-1", status: "ACTIVE" };
      const tx = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("Lock timeout")),
        cart: {
          findFirst: jest.fn().mockResolvedValue(mockCart),
        },
      };

      const result = await lockActiveCartByUser(tx, "user-1");
      expect(result).toEqual(mockCart);
      expect(tx.cart.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", status: "ACTIVE" },
      });
    });

    it("FAILS CLOSED (throws error) in production when $queryRaw throws", async () => {
      process.env.NODE_ENV = "production";
      const tx = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("Lock acquisition failure")),
        cart: {
          findFirst: jest.fn().mockResolvedValue({ id: "cart-1" }),
        },
      };

      await expect(lockActiveCartByUser(tx, "user-1")).rejects.toThrow(
        "Lock acquisition failure",
      );
      expect(tx.cart.findFirst).not.toHaveBeenCalled();
    });

    it("FAILS CLOSED in production when $queryRaw is missing", async () => {
      process.env.NODE_ENV = "production";
      const tx = {
        cart: {
          findFirst: jest.fn().mockResolvedValue({ id: "cart-1" }),
        },
      };

      await expect(lockActiveCartByUser(tx, "user-1")).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(tx.cart.findFirst).not.toHaveBeenCalled();
    });
  });
});
