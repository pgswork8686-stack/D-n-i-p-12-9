import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { prisma, PaymentStatus, OrderStatus } from "@nexus/database";
import {
  TestPaymentCallbackResponse,
  PaymentSessionResponse,
  PaymentWebhookResponse,
  ReconcilePaymentResponse,
  PaymentDto,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import {
  TestPaymentCallbackDto,
  CreatePaymentSessionDto,
  ReconcilePaymentDto,
} from "./dto/payments.dto";
import { TestPaymentProvider } from "./test-payment.provider";
import { PaymentProviderFactory } from "./payment-provider.factory";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly testProvider: TestPaymentProvider,
    private readonly providerFactory: PaymentProviderFactory,
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
      }, { maxWait: 10000, timeout: 20000 });
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

  /**
   * Creates an authenticated payment session for an order.
   * Enforces user ownership, PENDING_PAYMENT status, PENDING payment,
   * immutable pricing & currency from DB, and stable provider idempotency key.
   */
  async createPaymentSession(
    userId: string,
    orderId: string,
    dto?: CreatePaymentSessionDto,
  ): Promise<PaymentSessionResponse> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    if (order.userId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        `Order is not in pending payment state (status: ${order.status})`,
      );
    }

    // Resolve provider adapter (validates provider exists and enforces production block on test provider)
    const providerName = (dto?.provider || "stripe").toLowerCase();
    const adapter = this.providerFactory.getAdapter(providerName);

    // Find existing pending payment or create one authoritatively from order total and currency
    let payment = order.payments.find(
      (p) => p.status === PaymentStatus.PENDING,
    );

    if (!payment) {
      payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          provider: adapter.providerName,
          status: PaymentStatus.PENDING,
          amount: order.totalAmount,
          currency: order.currency,
        },
      });
    }

    // Idempotent reuse: if active session already generated on this provider, reuse it
    if (payment.providerReference && payment.provider === adapter.providerName) {
      return {
        sessionId: payment.providerReference,
        sessionUrl: `https://checkout.stripe.com/c/pay/${payment.providerReference}`,
        provider: adapter.providerName,
        providerReference: payment.providerReference,
        paymentId: payment.id,
        orderId: order.id,
        amount: payment.amount,
        currency: payment.currency,
      };
    }

    const session = await adapter.createPaymentSession({
      order,
      payment,
      successUrl: dto?.successUrl,
      cancelUrl: dto?.cancelUrl,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        provider: adapter.providerName,
        providerReference: session.providerReference,
      },
    });

    return {
      sessionId: session.sessionId,
      sessionUrl: session.sessionUrl,
      provider: adapter.providerName,
      providerReference: session.providerReference,
      paymentId: payment.id,
      orderId: order.id,
      amount: payment.amount,
      currency: payment.currency,
    };
  }

  /**
   * Processes an incoming provider webhook.
   * Enforces raw-body signature verification, payment binding verification,
   * fail-closed validation, and atomic transactional state transition.
   */
  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<PaymentWebhookResponse> {
    const adapter = this.providerFactory.getAdapter(providerName);

    // Fail-closed raw body signature & tolerance verification
    // Throws on missing/invalid/tampered/expired signature with ZERO DB mutation
    const normalizedEvent = await adapter.verifyWebhook(rawBody, headers);

    if (normalizedEvent.eventType === "ignored") {
      return {
        success: true,
        duplicate: false,
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: OrderStatus.PENDING_PAYMENT,
        message: "Webhook event type is ignored",
      };
    }

    // Sequential idempotency check via compound unique constraint (provider, externalEventId)
    const existingEvent = await prisma.paymentEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: adapter.providerName,
          externalEventId: normalizedEvent.externalEventId,
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
        `Idempotent payment event already processed: ${normalizedEvent.externalEventId}`,
      );
      return {
        success: true,
        duplicate: true,
        paymentStatus: existingEvent.payment.status,
        orderStatus: existingEvent.payment.order.status,
        message: "Payment event already processed",
      };
    }

    // Payment binding verification
    const payment = await prisma.payment.findUnique({
      where: { id: normalizedEvent.paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment '${normalizedEvent.paymentId}' not found`,
      );
    }

    // Amount binding verification: fail closed
    if (
      normalizedEvent.amount !== undefined &&
      payment.amount !== normalizedEvent.amount
    ) {
      throw new BadRequestException(
        `Amount mismatch: expected ${payment.amount}, received ${normalizedEvent.amount}`,
      );
    }

    // Currency binding verification: fail closed
    if (
      normalizedEvent.currency &&
      payment.currency.toUpperCase() !== normalizedEvent.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        `Currency mismatch: expected ${payment.currency}, received ${normalizedEvent.currency}`,
      );
    }

    // Order ID binding verification: fail closed
    if (
      normalizedEvent.orderId &&
      payment.orderId !== normalizedEvent.orderId
    ) {
      throw new BadRequestException(
        `Order ID mismatch: expected ${payment.orderId}, received ${normalizedEvent.orderId}`,
      );
    }

    // Provider reference binding verification: fail closed if already set
    if (
      payment.providerReference &&
      normalizedEvent.providerReference &&
      payment.providerReference !== normalizedEvent.providerReference
    ) {
      const isStripeCrossReference =
        adapter.providerName === "stripe" &&
        ((payment.providerReference.startsWith("cs_") &&
          normalizedEvent.providerReference.startsWith("pi_")) ||
          (payment.providerReference.startsWith("pi_") &&
            normalizedEvent.providerReference.startsWith("cs_")));

      if (!isStripeCrossReference) {
        throw new BadRequestException(
          `Provider reference mismatch: expected ${payment.providerReference}, received ${normalizedEvent.providerReference}`,
        );
      }
    }

    if (normalizedEvent.eventType === "payment.succeeded") {
      return this.processAuthoritativePaymentSuccess({
        provider: adapter.providerName,
        externalEventId: normalizedEvent.externalEventId,
        paymentId: payment.id,
        providerReference: normalizedEvent.providerReference,
        rawPayloadHash: normalizedEvent.rawPayloadHash,
        sanitizedPayload: normalizedEvent.sanitizedPayload,
      });
    } else if (normalizedEvent.eventType === "payment.failed") {
      return this.processAuthoritativePaymentFailure({
        provider: adapter.providerName,
        externalEventId: normalizedEvent.externalEventId,
        paymentId: payment.id,
        rawPayloadHash: normalizedEvent.rawPayloadHash,
        sanitizedPayload: normalizedEvent.sanitizedPayload,
      });
    } else if (normalizedEvent.eventType === "payment.cancelled") {
      return this.processAuthoritativePaymentCancellation({
        provider: adapter.providerName,
        externalEventId: normalizedEvent.externalEventId,
        paymentId: payment.id,
        rawPayloadHash: normalizedEvent.rawPayloadHash,
        sanitizedPayload: normalizedEvent.sanitizedPayload,
      });
    }

    return {
      success: true,
      duplicate: false,
      paymentStatus: payment.status,
      orderStatus: payment.order.status,
      message: `Unrecognized event type '${normalizedEvent.eventType}'`,
    };
  }

  /**
   * Atomic payment success processor shared between Webhook and Reconciler.
   * Single transaction:
   * 1. Check/Insert PaymentEvent
   * 2. Check terminal state
   * 3. CAS Payment -> SUCCEEDED
   * 4. CAS Order -> PAID
   * 5. Insert ORDER_PAID Outbox
   * 6. Insert Audit log
   */
  async processAuthoritativePaymentSuccess(params: {
    provider: string;
    externalEventId: string;
    paymentId: string;
    providerReference?: string;
    rawPayloadHash?: string;
    sanitizedPayload?: Record<string, any>;
  }): Promise<PaymentWebhookResponse> {
    const {
      provider,
      externalEventId,
      paymentId,
      providerReference,
      rawPayloadHash,
      sanitizedPayload,
    } = params;

    try {
      return await prisma.$transaction(async (tx) => {
        // Re-read payment and order inside transaction to lock and prevent dirty reads
        const txPayment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { order: true },
        });

        if (!txPayment) {
          throw new NotFoundException(`Payment '${paymentId}' not found`);
        }

        // Terminal state safety:
        // - SUCCEEDED is terminal: idempotent return (record event if new externalEventId, do not emit outbox again)
        // - FAILED/CANCELLED are terminal on this payment attempt: cannot transition to SUCCEEDED
        if (txPayment.status === PaymentStatus.SUCCEEDED) {
          this.logger.log(
            `Payment ${txPayment.id} is already in terminal state SUCCEEDED.`,
          );
          // Still record PaymentEvent for audit history if it has a unique externalEventId
          const existingEvt = await tx.paymentEvent.findUnique({
            where: {
              provider_externalEventId: {
                provider,
                externalEventId,
              },
            },
          });
          if (!existingEvt) {
            await tx.paymentEvent.create({
              data: {
                paymentId: txPayment.id,
                provider,
                eventType: "payment.succeeded",
                externalEventId,
                payload: (sanitizedPayload || {}) as any,
                rawPayloadHash: rawPayloadHash || null,
              },
            });
          }
          return {
            success: true,
            duplicate: true,
            paymentStatus: txPayment.status,
            orderStatus: txPayment.order.status,
            message: "Payment already in terminal state SUCCEEDED",
          };
        }

        if (txPayment.status === PaymentStatus.CANCELLED) {
          this.logger.log(
            `Payment ${txPayment.id} is in terminal state CANCELLED. Ignoring success event.`,
          );
          return {
            success: true,
            duplicate: false,
            paymentStatus: txPayment.status,
            orderStatus: txPayment.order.status,
            message: `Payment already in terminal state ${txPayment.status}`,
          };
        }

        // Insert PaymentEvent (enforces @@unique([provider, externalEventId]))
        await tx.paymentEvent.create({
          data: {
            paymentId: txPayment.id,
            provider,
            eventType: "payment.succeeded",
            externalEventId,
            payload: (sanitizedPayload || {}) as any,
            rawPayloadHash: rawPayloadHash || null,
          },
        });

        // CAS update Payment from PENDING or FAILED -> SUCCEEDED
        const payCas = await tx.payment.updateMany({
          where: {
            id: txPayment.id,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
          },
          data: {
            status: PaymentStatus.SUCCEEDED,
            providerReference:
              providerReference || txPayment.providerReference,
          },
        });

        if (payCas.count === 0) {
          // Concurrent race won by another worker!
          const currentPayment = await tx.payment.findUniqueOrThrow({
            where: { id: txPayment.id },
            include: { order: true },
          });
          return {
            success: true,
            duplicate: true,
            paymentStatus: currentPayment.status,
            orderStatus: currentPayment.order.status,
            message: `Payment already transitioned to ${currentPayment.status}`,
          };
        }

        // CAS update Order from PENDING_PAYMENT -> PAID
        const orderCas = await tx.order.updateMany({
          where: {
            id: txPayment.orderId,
            status: OrderStatus.PENDING_PAYMENT,
          },
          data: { status: OrderStatus.PAID },
        });

        if (orderCas.count === 0) {
          // Check if order is already PAID by concurrent transaction
          const currentOrder = await tx.order.findUniqueOrThrow({
            where: { id: txPayment.orderId },
          });
          if (currentOrder.status !== OrderStatus.PAID) {
            throw new ConflictException(
              `Order '${txPayment.orderId}' is in state ${currentOrder.status}, cannot transition to PAID`,
            );
          }
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

        // Authoritative audit log in same transaction
        await this.auditService.logActionWithClient(tx, {
          action: "ORDER_PAID",
          entity: "Order",
          entityId: txPayment.order.id,
          actorId: txPayment.order.userId,
          details: {
            paymentId: txPayment.id,
            externalEventId,
            totalAmount: txPayment.order.totalAmount,
            currency: txPayment.order.currency,
            provider,
          },
        });

        return {
          success: true,
          duplicate: false,
          paymentStatus: PaymentStatus.SUCCEEDED,
          orderStatus: OrderStatus.PAID,
          message: "Payment processed successfully",
        };
      }, { maxWait: 10000, timeout: 20000 });
    } catch (err: any) {
      // Catch Prisma P2002 (Unique constraint failed on provider + externalEventId) in race conditions
      if (
        err?.code === "P2002" ||
        err?.message?.includes("payment_events_provider_external_event_id_key") ||
        err?.message?.includes("external_event_id")
      ) {
        this.logger.warn(
          `Concurrent duplicate event race detected on ${provider}:${externalEventId}`,
        );
        const reloadedPayment = await prisma.payment.findUnique({
          where: { id: paymentId },
          include: { order: true },
        });
        return {
          success: true,
          duplicate: true,
          paymentStatus: reloadedPayment?.status || PaymentStatus.SUCCEEDED,
          orderStatus: reloadedPayment?.order?.status || OrderStatus.PAID,
          message: "Concurrent duplicate event handled idempotently",
        };
      }
      throw err;
    }
  }

  /**
   * Authoritative payment failure processor.
   */
  async processAuthoritativePaymentFailure(params: {
    provider: string;
    externalEventId: string;
    paymentId: string;
    rawPayloadHash?: string;
    sanitizedPayload?: Record<string, any>;
  }): Promise<PaymentWebhookResponse> {
    const {
      provider,
      externalEventId,
      paymentId,
      rawPayloadHash,
      sanitizedPayload,
    } = params;

    return await prisma.$transaction(async (tx) => {
      const txPayment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { order: true },
      });

      if (!txPayment) {
        throw new NotFoundException(`Payment '${paymentId}' not found`);
      }

      // Terminal state preservation: Never SUCCEEDED -> FAILED
      if (txPayment.status === PaymentStatus.SUCCEEDED) {
        this.logger.log(
          `Payment ${txPayment.id} is already in terminal state SUCCEEDED. Ignoring failed event.`,
        );
        return {
          success: true,
          duplicate: true,
          paymentStatus: txPayment.status,
          orderStatus: txPayment.order.status,
          message: "Payment already in terminal state SUCCEEDED",
        };
      }

      if (txPayment.status === PaymentStatus.FAILED) {
        return {
          success: true,
          duplicate: true,
          paymentStatus: txPayment.status,
          orderStatus: txPayment.order.status,
          message: "Payment already in terminal state FAILED",
        };
      }

      await tx.paymentEvent.create({
        data: {
          paymentId: txPayment.id,
          provider,
          eventType: "payment.failed",
          externalEventId,
          payload: (sanitizedPayload || {}) as any,
          rawPayloadHash: rawPayloadHash || null,
        },
      });

      await tx.payment.updateMany({
        where: {
          id: txPayment.id,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.FAILED },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "PAYMENT_FAILED",
        entity: "Payment",
        entityId: txPayment.id,
        actorId: txPayment.order.userId,
        details: {
          orderId: txPayment.orderId,
          externalEventId,
          provider,
        },
      });

      return {
        success: true,
        duplicate: false,
        paymentStatus: PaymentStatus.FAILED,
        orderStatus: txPayment.order.status,
        message: "Payment event marked as failed",
      };
    }, { maxWait: 10000, timeout: 20000 });
  }

  /**
   * Authoritative payment cancellation processor.
   */
  async processAuthoritativePaymentCancellation(params: {
    provider: string;
    externalEventId: string;
    paymentId: string;
    rawPayloadHash?: string;
    sanitizedPayload?: Record<string, any>;
  }): Promise<PaymentWebhookResponse> {
    const {
      provider,
      externalEventId,
      paymentId,
      rawPayloadHash,
      sanitizedPayload,
    } = params;

    return await prisma.$transaction(async (tx) => {
      const txPayment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { order: true },
      });

      if (!txPayment) {
        throw new NotFoundException(`Payment '${paymentId}' not found`);
      }

      if (txPayment.status === PaymentStatus.SUCCEEDED) {
        return {
          success: true,
          duplicate: true,
          paymentStatus: txPayment.status,
          orderStatus: txPayment.order.status,
          message: "Payment already in terminal state SUCCEEDED",
        };
      }

      await tx.paymentEvent.create({
        data: {
          paymentId: txPayment.id,
          provider,
          eventType: "payment.cancelled",
          externalEventId,
          payload: (sanitizedPayload || {}) as any,
          rawPayloadHash: rawPayloadHash || null,
        },
      });

      await tx.payment.updateMany({
        where: {
          id: txPayment.id,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.CANCELLED },
      });

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
          externalEventId,
          provider,
        },
      });

      return {
        success: true,
        duplicate: false,
        paymentStatus: PaymentStatus.CANCELLED,
        orderStatus: currentOrder.status,
        message: "Payment event marked as cancelled",
      };
    }, { maxWait: 10000, timeout: 20000 });
  }

  /**
   * Reconciles a payment by actively querying the upstream provider.
   * If provider confirms payment is paid/succeeded, invokes the EXACT SAME
   * authoritative success processor.
   */
  async reconcilePayment(
    paymentId: string,
    dto?: ReconcilePaymentDto,
  ): Promise<ReconcilePaymentResponse> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment '${paymentId}' not found`);
    }

    if (payment.status !== PaymentStatus.PENDING) {
      return {
        success: true,
        transitioned: false,
        paymentStatus: payment.status,
        orderStatus: payment.order.status,
        message: `Payment is already in non-pending state ${payment.status}`,
      };
    }

    const adapter = this.providerFactory.getAdapter(payment.provider);
    if (!adapter.queryPaymentStatus || !payment.providerReference) {
      return {
        success: true,
        transitioned: false,
        paymentStatus: payment.status,
        orderStatus: payment.order.status,
        message:
          "Active reconciliation is not supported for this provider or payment has no reference",
      };
    }

    const statusResult = await adapter.queryPaymentStatus(
      payment.providerReference,
    );

    if (!statusResult) {
      return {
        success: true,
        transitioned: false,
        paymentStatus: payment.status,
        orderStatus: payment.order.status,
        message: "No provider status available",
      };
    }

    if (statusResult.status === PaymentStatus.SUCCEEDED) {
      const reconcileEventId =
        statusResult.externalEventId ||
        `reconcile_${payment.providerReference}_success`;

      const result = await this.processAuthoritativePaymentSuccess({
        provider: adapter.providerName,
        externalEventId: reconcileEventId,
        paymentId: payment.id,
        providerReference: payment.providerReference,
        rawPayloadHash: undefined,
        sanitizedPayload: {
          reconciled: true,
          reconciledAt: new Date().toISOString(),
          reason: dto?.reason || "authoritative_status_query",
        },
      });

      return {
        success: true,
        transitioned: !result.duplicate,
        paymentStatus: result.paymentStatus,
        orderStatus: result.orderStatus,
        message: result.message,
      };
    }

    return {
      success: true,
      transitioned: false,
      paymentStatus: payment.status,
      orderStatus: payment.order.status,
      message: `Provider status is '${statusResult.status}', no transition required`,
    };
  }

  /**
   * Retrieves read-only payment information.
   */
  async getPayment(id: string): Promise<PaymentDto> {
    const payment = await prisma.payment.findUnique({
      where: { id },
    });
    if (!payment) {
      throw new NotFoundException(`Payment '${id}' not found`);
    }
    return {
      id: payment.id,
      orderId: payment.orderId,
      provider: payment.provider,
      providerReference: payment.providerReference,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      metadata: payment.metadata as Record<string, any> | null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
