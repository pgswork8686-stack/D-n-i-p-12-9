import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { prisma, PaymentStatus, OrderStatus } from "@nexus/database";
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
   * Enforces fail-closed signature verification, strict idempotency, CAS transitions,
   * terminal state preservation, and transactional outbox emission.
   */
  async processTestCallback(
    dto: TestPaymentCallbackDto,
    headers?: Record<string, string>,
  ): Promise<TestPaymentCallbackResponse> {
    // 1. Fail-closed provider & signature verification
    await this.testProvider.verifyEvent(dto, headers);

    // 2. Sequential idempotency check via compound unique key
    const existingEvent = await prisma.paymentEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: "TEST",
          externalEventId: dto.externalEventId,
        },
      },
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

    // 3. Load initial payment to check existence
    const payment = await prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment '${dto.paymentId}' not found`);
    }

    // 4. Atomic state transition and outbox emission inside transaction
    try {
      return await prisma.$transaction(async (tx) => {
        // Record PaymentEvent (protected by @@unique([provider, externalEventId]))
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            provider: "TEST",
            eventType: dto.eventType,
            externalEventId: dto.externalEventId,
            payload: (dto.metadata || {}) as any,
          },
        });

        // Re-read inside transaction to avoid stale dirty reads
        const txPayment = await tx.payment.findUnique({
          where: { id: payment.id },
          include: { order: true },
        });

        if (!txPayment) {
          throw new NotFoundException(
            `Payment '${payment.id}' not found in transaction`,
          );
        }

        // Terminal state preservation:
        // - SUCCEEDED is terminal: cannot transition to FAILED or CANCELLED
        // - FAILED/CANCELLED are terminal on this payment attempt: cannot transition to SUCCEEDED
        // - Order status PAID cannot be reversed to CANCELLED by normal callback
        if (txPayment.status === PaymentStatus.SUCCEEDED) {
          this.logger.log(
            `Payment ${txPayment.id} is already in terminal state SUCCEEDED. Ignoring event ${dto.eventType}`,
          );
          return {
            success: true,
            duplicate: false,
            paymentStatus: txPayment.status,
            orderStatus: txPayment.order.status,
            message: "Payment already in terminal state SUCCEEDED",
          };
        }

        if (
          txPayment.status === PaymentStatus.FAILED ||
          txPayment.status === PaymentStatus.CANCELLED
        ) {
          this.logger.log(
            `Payment ${txPayment.id} is in terminal state ${txPayment.status}. Ignoring transition to ${dto.eventType}`,
          );
          return {
            success: true,
            duplicate: false,
            paymentStatus: txPayment.status,
            orderStatus: txPayment.order.status,
            message: `Payment already in terminal state ${txPayment.status}`,
          };
        }

        // State machine transitions from PENDING
        if (dto.eventType === "payment.succeeded") {
          // CAS update payment from PENDING -> SUCCEEDED
          const payCas = await tx.payment.updateMany({
            where: {
              id: txPayment.id,
              status: PaymentStatus.PENDING,
            },
            data: { status: PaymentStatus.SUCCEEDED },
          });

          if (payCas.count === 0) {
            // Concurrent event won the race! Re-read current actual state from DB
            const currentPayment = await tx.payment.findUniqueOrThrow({
              where: { id: txPayment.id },
              include: { order: true },
            });
            return {
              success: true,
              duplicate: false,
              paymentStatus: currentPayment.status,
              orderStatus: currentPayment.order.status,
              message: `Payment already in state ${currentPayment.status}`,
            };
          }

          // Payment CAS won! Now CAS update Order from PENDING_PAYMENT -> PAID
          const orderCas = await tx.order.updateMany({
            where: {
              id: txPayment.orderId,
              status: OrderStatus.PENDING_PAYMENT,
            },
            data: { status: OrderStatus.PAID },
          });

          if (orderCas.count === 0) {
            // Invariant violation: payment was pending but order cannot be marked PAID
            throw new ConflictException(
              "Order is not in pending payment state; cannot transition to PAID",
            );
          }

          // Exactly-once ORDER_PAID outbox event at the business level
          await tx.outboxEvent.create({
            data: {
              eventType: "ORDER_PAID",
              aggregateType: "Order",
              aggregateId: txPayment.order.id,
              payload: {
                orderId: txPayment.order.id,
                orderNumber: txPayment.order.orderNumber,
                userId: txPayment.order.userId,
                totalAmount: txPayment.order.totalAmount,
                currency: txPayment.order.currency,
                paymentId: txPayment.id,
              },
              status: "PENDING",
            },
          });

          await this.auditService.logActionWithClient(tx, {
            action: "ORDER_PAID",
            entity: "Order",
            entityId: txPayment.order.id,
            actorId: txPayment.order.userId,
            details: {
              paymentId: txPayment.id,
              externalEventId: dto.externalEventId,
              totalAmount: txPayment.order.totalAmount,
              currency: txPayment.order.currency,
            },
          });

          return {
            success: true,
            duplicate: false,
            paymentStatus: PaymentStatus.SUCCEEDED,
            orderStatus: OrderStatus.PAID,
            message: "Payment event processed successfully",
          };
        } else if (dto.eventType === "payment.failed") {
          const payCas = await tx.payment.updateMany({
            where: {
              id: txPayment.id,
              status: PaymentStatus.PENDING,
            },
            data: { status: PaymentStatus.FAILED },
          });

          if (payCas.count === 0) {
            const currentPayment = await tx.payment.findUniqueOrThrow({
              where: { id: txPayment.id },
              include: { order: true },
            });
            return {
              success: true,
              duplicate: false,
              paymentStatus: currentPayment.status,
              orderStatus: currentPayment.order.status,
              message: `Payment already in state ${currentPayment.status}`,
            };
          }

          await this.auditService.logActionWithClient(tx, {
            action: "PAYMENT_FAILED",
            entity: "Payment",
            entityId: txPayment.id,
            actorId: txPayment.order.userId,
            details: {
              orderId: txPayment.orderId,
              externalEventId: dto.externalEventId,
            },
          });

          return {
            success: true,
            duplicate: false,
            paymentStatus: PaymentStatus.FAILED,
            orderStatus: txPayment.order.status,
            message: "Payment event marked as failed",
          };
        } else if (dto.eventType === "payment.cancelled") {
          const payCas = await tx.payment.updateMany({
            where: {
              id: txPayment.id,
              status: PaymentStatus.PENDING,
            },
            data: { status: PaymentStatus.CANCELLED },
          });

          if (payCas.count === 0) {
            const currentPayment = await tx.payment.findUniqueOrThrow({
              where: { id: txPayment.id },
              include: { order: true },
            });
            return {
              success: true,
              duplicate: false,
              paymentStatus: currentPayment.status,
              orderStatus: currentPayment.order.status,
              message: `Payment already in state ${currentPayment.status}`,
            };
          }

          // Only cancel order if not already PAID
          await tx.order.updateMany({
            where: {
              id: txPayment.orderId,
              status: OrderStatus.PENDING_PAYMENT,
            },
            data: { status: OrderStatus.CANCELLED },
          });

          const currentOrder = await tx.order.findUniqueOrThrow({
            where: { id: txPayment.orderId },
          });

          await this.auditService.logActionWithClient(tx, {
            action: "PAYMENT_CANCELLED",
            entity: "Payment",
            entityId: txPayment.id,
            actorId: txPayment.order.userId,
            details: {
              orderId: txPayment.orderId,
              externalEventId: dto.externalEventId,
            },
          });

          return {
            success: true,
            duplicate: false,
            paymentStatus: PaymentStatus.CANCELLED,
            orderStatus: currentOrder.status,
            message: "Payment event marked as cancelled",
          };
        }

        return {
          success: true,
          duplicate: false,
          paymentStatus: txPayment.status,
          orderStatus: txPayment.order.status,
          message: `Unrecognized event type '${dto.eventType}'`,
        };
      });
    } catch (err: any) {
      // Catch Prisma P2002 (Unique constraint failed on provider + externalEventId) in race conditions
      if (
        err?.code === "P2002" ||
        err?.message?.includes(
          "payment_events_provider_external_event_id_key",
        ) ||
        err?.message?.includes("external_event_id")
      ) {
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
