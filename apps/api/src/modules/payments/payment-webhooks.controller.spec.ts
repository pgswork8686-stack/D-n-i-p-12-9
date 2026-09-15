import { Test, TestingModule } from "@nestjs/testing";
import { PaymentWebhooksController } from "./payment-webhooks.controller";
import { PaymentsService } from "./payments.service";

describe("PaymentWebhooksController", () => {
  let controller: PaymentWebhooksController;
  let service: PaymentsService;

  const mockPaymentsService = {
    handleWebhook: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentWebhooksController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentWebhooksController>(
      PaymentWebhooksController,
    );
    service = module.get<PaymentsService>(PaymentsService);
  });

  it("extracts rawBody Buffer and forwards to PaymentsService.handleWebhook", async () => {
    mockPaymentsService.handleWebhook.mockResolvedValue({
      success: true,
      duplicate: false,
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      message: "Payment processed successfully",
    });

    const rawBuffer = Buffer.from('{"id":"evt_123"}', "utf8");
    const req = { rawBody: rawBuffer, body: {} } as any;
    const headers = { "stripe-signature": "sig_test_123" };

    const res = await controller.handleWebhook("stripe", req, headers);

    expect(service.handleWebhook).toHaveBeenCalledWith(
      "stripe",
      rawBuffer,
      headers,
    );
    expect(res.success).toBe(true);
    expect(res.paymentStatus).toBe("SUCCEEDED");
  });
});
