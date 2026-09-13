import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { TestPaymentEventType } from "./dto/payments.dto";

describe("PaymentsController", () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  const mockPaymentsService = {
    processTestCallback: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
  });

  it("handleTestCallback delegates to PaymentsService.processTestCallback", async () => {
    mockPaymentsService.processTestCallback.mockResolvedValue({
      success: true,
      duplicate: false,
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      message: "Payment event processed successfully",
    });

    const dto = {
      paymentId: "pay-123",
      externalEventId: "evt-ext-123",
      eventType: TestPaymentEventType.SUCCEEDED,
    };

    const res = await controller.handleTestCallback(dto);

    expect(service.processTestCallback).toHaveBeenCalledWith(dto);
    expect(res.success).toBe(true);
    expect(res.paymentStatus).toBe("SUCCEEDED");
    expect(res.orderStatus).toBe("PAID");
  });
});
