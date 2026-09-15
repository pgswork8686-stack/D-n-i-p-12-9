import { Test, TestingModule } from "@nestjs/testing";
import { PaymentSessionController } from "./payment-session.controller";
import { PaymentsService } from "./payments.service";
import { AuthGuard } from "../auth/auth.guard";

describe("PaymentSessionController", () => {
  let controller: PaymentSessionController;
  let service: PaymentsService;

  const mockPaymentsService = {
    createPaymentSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentSessionController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentSessionController>(
      PaymentSessionController,
    );
    service = module.get<PaymentsService>(PaymentsService);
  });

  it("delegates to PaymentsService.createPaymentSession with userId and orderId", async () => {
    mockPaymentsService.createPaymentSession.mockResolvedValue({
      sessionId: "cs_123",
      sessionUrl: "https://checkout.stripe.com/pay/cs_123",
      provider: "stripe",
      providerReference: "cs_123",
      paymentId: "pay-1",
      orderId: "ord-1",
      amount: 5000,
      currency: "USD",
    });

    const req = { user: { id: "user-123" } };
    const dto = { provider: "stripe" };

    const res = await controller.createPaymentSession(req, "ord-1", dto);

    expect(service.createPaymentSession).toHaveBeenCalledWith(
      "user-123",
      "ord-1",
      dto,
    );
    expect(res.sessionId).toBe("cs_123");
    expect(res.amount).toBe(5000);
  });
});
