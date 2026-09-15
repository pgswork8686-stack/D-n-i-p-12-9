import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { TestPaymentEventType } from "./dto/payments.dto";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { PaymentReconcileReason } from "@nexus/contracts";

describe("PaymentsController", () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  const mockPaymentsService = {
    getPayment: jest.fn(),
    processTestCallback: jest.fn(),
    reconcilePayment: jest.fn(),
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
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
  });

  it("getPayment delegates to PaymentsService.getPayment with user context", async () => {
    mockPaymentsService.getPayment.mockResolvedValue({
      id: "pay-1",
      orderId: "ord-1",
      status: "SUCCEEDED",
      amount: 5000,
      currency: "USD",
    });

    const req = { user: { id: "user-1", roles: ["customer"], permissions: [] } };
    const res = await controller.getPayment("pay-1", req);

    expect(service.getPayment).toHaveBeenCalledWith("pay-1", req.user);
    expect(res.id).toBe("pay-1");
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
    const headers = { "x-test-signature": "test_sig_123" };

    const res = await controller.handleTestCallback(headers, dto);

    expect(service.processTestCallback).toHaveBeenCalledWith(dto, headers);
    expect(res.success).toBe(true);
    expect(res.paymentStatus).toBe("SUCCEEDED");
    expect(res.orderStatus).toBe("PAID");
  });

  it("reconcilePayment delegates to PaymentsService.reconcilePayment with reason", async () => {
    mockPaymentsService.reconcilePayment.mockResolvedValue({
      success: true,
      transitioned: true,
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      message: "Reconciliation complete",
    });

    const dto = { reason: PaymentReconcileReason.OPS_MANUAL };
    const res = await controller.reconcilePayment("pay-123", dto);

    expect(service.reconcilePayment).toHaveBeenCalledWith("pay-123", dto);
    expect(res.transitioned).toBe(true);
  });
});
