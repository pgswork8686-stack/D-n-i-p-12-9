import { Test, TestingModule } from "@nestjs/testing";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { AuthGuard } from "../auth/auth.guard";
import { Currency } from "@nexus/database";

describe("CartController", () => {
  let controller: CartController;
  let service: CartService;

  const mockCartService = {
    getCart: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
    clearCart: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CartController],
      providers: [
        {
          provide: CartService,
          useValue: mockCartService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CartController>(CartController);
    service = module.get<CartService>(CartService);
  });

  it("getCart passes userId and currency to service", async () => {
    mockCartService.getCart.mockResolvedValue({ id: "cart-1", items: [] });

    const req = { user: { id: "user-123" } };
    const res = await controller.getCart(req, { currency: Currency.VND });

    expect(service.getCart).toHaveBeenCalledWith("user-123", Currency.VND);
    expect(res.id).toBe("cart-1");
  });

  it("addItem passes userId and dto to service", async () => {
    mockCartService.addItem.mockResolvedValue({ id: "cart-1" });

    const req = { user: { id: "user-123" } };
    const dto = { variantId: "var-1", quantity: 2, currency: Currency.USD };
    const res = await controller.addItem(req, dto);

    expect(service.addItem).toHaveBeenCalledWith("user-123", dto);
    expect(res.id).toBe("cart-1");
  });

  it("updateItem passes itemId, quantity and currency", async () => {
    mockCartService.updateItem.mockResolvedValue({ id: "cart-1" });

    const req = { user: { id: "user-123" } };
    await controller.updateItem(
      req,
      "item-1",
      { quantity: 5 },
      { currency: Currency.USD },
    );

    expect(service.updateItem).toHaveBeenCalledWith(
      "user-123",
      "item-1",
      5,
      Currency.USD,
    );
  });

  it("removeItem passes itemId and currency", async () => {
    mockCartService.removeItem.mockResolvedValue({ id: "cart-1" });

    const req = { user: { id: "user-123" } };
    await controller.removeItem(req, "item-1", { currency: Currency.USD });

    expect(service.removeItem).toHaveBeenCalledWith(
      "user-123",
      "item-1",
      Currency.USD,
    );
  });

  it("clearCart passes userId", async () => {
    mockCartService.clearCart.mockResolvedValue({ success: true });

    const req = { user: { id: "user-123" } };
    const res = await controller.clearCart(req);

    expect(service.clearCart).toHaveBeenCalledWith("user-123");
    expect(res.success).toBe(true);
  });
});
