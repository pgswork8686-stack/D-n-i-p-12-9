import { Test, TestingModule } from "@nestjs/testing";
import { OrdersController } from "./orders.controller";
import { CheckoutController } from "./checkout.controller";
import { OrdersService } from "./orders.service";
import { AuthGuard } from "../auth/auth.guard";
import { Currency, OrderStatus } from "@nexus/database";

describe("OrdersController & CheckoutController", () => {
  let ordersController: OrdersController;
  let checkoutController: CheckoutController;
  let service: OrdersService;

  const mockOrdersService = {
    checkout: jest.fn(),
    listCustomerOrders: jest.fn(),
    getCustomerOrder: jest.fn(),
    listAdminOrders: jest.fn(),
    getAdminOrder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController, CheckoutController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    ordersController = module.get<OrdersController>(OrdersController);
    checkoutController = module.get<CheckoutController>(CheckoutController);
    service = module.get<OrdersService>(OrdersService);
  });

  it("checkout passes userId and dto to service", async () => {
    mockOrdersService.checkout.mockResolvedValue({
      order: { id: "order-1", orderNumber: "ORD-001" },
      payment: { id: "pay-1" },
    });

    const req = { user: { id: "user-123" } };
    const dto = { currency: Currency.USD };
    const res = await checkoutController.checkout(req, dto);

    expect(service.checkout).toHaveBeenCalledWith("user-123", dto);
    expect(res.order.id).toBe("order-1");
  });

  it("listOrders passes userId and query to service", async () => {
    mockOrdersService.listCustomerOrders.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = { user: { id: "user-123" } };
    const query = { page: 1, limit: 10, status: OrderStatus.PAID };
    const res = await ordersController.listOrders(req, query);

    expect(service.listCustomerOrders).toHaveBeenCalledWith("user-123", query);
    expect(res.items).toEqual([]);
  });

  it("getOrder passes userId and orderId to service", async () => {
    mockOrdersService.getCustomerOrder.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-001",
    });

    const req = { user: { id: "user-123" } };
    const res = await ordersController.getOrder(req, "order-1");

    expect(service.getCustomerOrder).toHaveBeenCalledWith("user-123", "order-1");
    expect(res.id).toBe("order-1");
  });
});
