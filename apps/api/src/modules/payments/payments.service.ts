import {
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  PaymentStatus,
  OrderStatus,
} from "@nexus/database";
import { TestPaymentCallbackResponse } from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import { TestPaymentCallbackDto } from "./dto/payments.dto";
import { TestPaymentProvider } from "./test-payment.provider";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly testProvider: TestPaymentProvider,
  ) {}

  /**
   * Processes a test payment webhook/callback.
   * Enforces strict idempotency and authoritative state transition.
   * Creates an OutboxEvent in the same atomic database transaction when payment succeeds.
   */
  async processTestCallback(
    dto: TestPaymentCallbackDto,
  ): Promise<TestPaymentCallbackResponse> {
    // 1. Adapter event verification
    await this.testProvider.verifyEvent(dto);

    // 2. Sequential idempotency check
    const existingEvent = await prisma.paymentEvent.findUnique({
      where: { externalEventId: dto.externalEventId },
      include: {
        payment: {
          include: { order: true },
        },
      },
    });

    if (existingEvent) {
      this.logger.log(
        `Idempotent payment event already processed: ${dto.externalEventId}`,
      );
      return {
        success: true,
        duplicate: true,
        paymentStatus: existingEvent.payment.status,
        orderStatus: existingEvent.payment.order.status,
        message: "Payment event already processed",
      };
    }

    // 3. Load payment with order
    const payment = await prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment '${dto.paymentId}' not found`);
    }

    // 4. Atomic state transition and outbox emission
    try {
      return await prisma.$transaction(async (tx) => {
        // Record PaymentEvent (protected by @@unique([externalEventId]))
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            provider: "TEST",
            eventType: dto.eventType,
            externalEventId: dto.externalEventId,
            payload: (dto.metadata || {}) as any,
          },
        });

        let newPaymentStatus: PaymentStatus = payment.status;
        let newOrderStatus: OrderStatus = payment.order.status;

        if (dto.eventType === "payment.succeeded") {
          newPaymentStatus = PaymentStatus.SUCCEEDED;
          newOrderStatus = OrderStatus.PAID;

          await tx.payment.update({
            where: { id: payment.id },
            data: { status: newPaymentStatus },
          });

          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: newOrderStatus },
          });

          // Insert Transactional Outbox Event
          await tx.outboxEvent.create({
            data: {
              eventType: "ORDER_PAID",
              aggregateType: "Order",
              aggregateId: payment.order.id,
              payload: {
                orderId: payment.order.id,
                orderNumber: payment.order.orderNumber,
                userId: payment.order.userId,
                totalAmount: payment.order.totalAmount,
                currency: payment.order.currency,
                paymentId: payment.id,
              },
              status: "PENDING",
            },
          });

          await this.auditService.logAction({
            action: "ORDER_PAID",
            entity: "Order",
            entityId: payment.order.id,
            actorId: payment.order.userId,
            details: {
              paymentId: payment.id,
              externalEventId: dto.externalEventId,
              totalAmount: payment.order.totalAmount,
              currency: payment.order.currency,
            },
          });
        } else if (dto.eventType === "payment.failed") {
          newPaymentStatus = PaymentStatus.FAILED;
          // Order status is NOT marked PAID
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: newPaymentStatus },
          });

          await this.auditService.logAction({
            action: "PAYMENT_FAILED",
            entity: "Payment",
            entityId: payment.id,
            actorId: payment.order.userId,
            details: {
              orderId: payment.orderId,
              externalEventId: dto.externalEventId,
            },
          });
        } else if (dto.eventType === "payment.cancelled") {
          newPaymentStatus = PaymentStatus.CANCELLED;
          newOrderStatus = OrderStatus.CANCELLED;

          await tx.payment.update({
            where: { id: payment.id },
            data: { status: newPaymentStatus },
          });

          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: newOrderStatus },
          });

          await this.auditService.logAction({
            action: "PAYMENT_CANCELLED",
            entity: "Payment",
            entityId: payment.id,
            actorId: payment.order.userId,
            details: {
              orderId: payment.orderId,
              externalEventId: dto.externalEventId,
            },
          });
        }

        this.logger.log(
          `Payment ${payment.id} transitioned to ${newPaymentStatus}, Order ${payment.orderId} to ${newOrderStatus}`,
        );

        return {
          success: true,
          duplicate: false,
          paymentStatus: newPaymentStatus,
          orderStatus: newOrderStatus,
          message: "Payment event processed successfully",
        };
      });
    } catch (err: any) {
      // Catch Prisma P2002 (Unique constraint failed on external_event_id) in concurrent race conditions
      if (err?.code === "P2002" || err?.message?.includes("external_event_id")) {
        this.logger.warn(
          `Concurrent duplicate event race detected and caught: ${dto.externalEventId}`,
        );
        const reloadedPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
          include: { order: true },
        });
        return {
          success: true,
          duplicate: true,
          paymentStatus: reloadedPayment?.status || payment.status,
          orderStatus: reloadedPayment?.order?.status || payment.order.status,
          message: "Concurrent duplicate event handled idempotently",
        };
      }
      throw err;
    }
  }
}
