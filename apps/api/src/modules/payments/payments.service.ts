import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
  Logger,
} from "@nestjs/common";
import { prisma, PaymentStatus, OrderStatus } from "@nexus/database";
import {
  TestPaymentCallbackResponse,
  PaymentSessionResponse,
  PaymentWebhookResponse,
  ReconcilePaymentResponse,
  PaymentDto,
  PaymentReconcileReason,
  AuthUser,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import {
  TestPaymentCallbackDto,
  CreatePaymentSessionDto,
  ReconcilePaymentDto,
} from "./dto/payments.dto";
import { TestPaymentProvider } from "./test-payment.provider";
import { PaymentProviderFactory } from "./payment-provider.factory";

interface AuthoritativePaymentEvidence {
  provider: string;
  externalEventId: string;
  paymentId: string;
  orderId: string;
  providerReference: string;
  amount: number;
  currency: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.cancelled";
  rawPayloadHash?: string;
  sanitizedPayload?: Record<string, any>;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly testProvider: TestPaymentProvider,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  private isPaymentEventUniqueError(err: any): boolean {
    const target = Array.isArray(err?.meta?.target)
      ? err.meta.target.join(",")
      : String(err?.meta?.target || "");
    return (
      err?.message?.includes("payment_events_provider_external_event_id_key") ||
      err?.message?.includes("external_event_id") ||
      (err?.code === "P2002" &&
        target.includes("provider") &&
        target.includes("external"))
    );
  }

  private isPendingPaymentUniqueError(err: any): boolean {
    const target = Array.isArray(err?.meta?.target)
      ? err.meta.target.join(",")
      : String(err?.meta?.target || "");
    return (
      err?.message?.includes("unique_pending_payment_per_order") ||
      (err?.code === "P2002" && target.includes("order"))
    );
  }

  private validateRedirectUrl(urlStr?: string): void {
    if (!urlStr) return;
    if (urlStr.startsWith("/") && !urlStr.startsWith("//")) return;

    try {
      const parsed = new URL(urlStr);
      const isProduction = process.env.NODE_ENV === "production";
      const allowedOrigins: string[] = [];
      const configuredOrigins = [
        process.env.PAYMENT_RETURN_BASE_URL,
        process.env.FRONTEND_URL,
        process.env.PORTAL_URL,
      ];

      for (const configured of configuredOrigins) {
        if (configured?.trim()) {
          allowedOrigins.push(new URL(configured.trim()).origin);
        }
      }

      if (process.env.ALLOWED_REDIRECT_ORIGINS) {
        for (const origin of process.env.ALLOWED_REDIRECT_ORIGINS.split(",")) {
          const trimmed = origin.trim();
          if (trimmed) allowedOrigins.push(new URL(trimmed).origin);
        }
      }

      if (!isProduction) {
        allowedOrigins.push(
          "http://localhost:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001",
        );
      }

      if (isProduction) {
        const host = parsed.hostname.toLowerCase();
        if (
          parsed.protocol !== "https:" ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "::1"
        ) {
          throw new BadRequestException(
            "Production payment redirect URLs must use a trusted HTTPS origin",
          );
        }
      }

      if (!allowedOrigins.includes(parsed.origin)) {
        throw new BadRequestException(
          `Untrusted redirect URL origin: ${parsed.origin}`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException("Invalid payment redirect URL");
    }
  }

  /** Phase 4 local/test callback flow; hard-blocked in production. */
  async processTestCallback(
    dto: TestPaymentCallbackDto,
    headers?: Record<string, string>,
  ): Promise<TestPaymentCallbackResponse> {
    await this.testProvider.verifyEvent(dto, headers);

    const existingEvent = await prisma.paymentEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: "TEST",
          externalEventId: dto.externalEventId,
        },
      },
      include: { payment: { include: { order: true } } },
    });

    if (existingEvent) {
      return {
        success: true,
        duplicate: true,
        paymentStatus: existingEvent.payment.status,
        orderStatus: existingEvent.payment.order.status,
        message: "Payment event already processed",
      };
    }

    const payment = await prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: { order: true },
    });
    if (!payment) {
      throw new NotFoundException(`Payment '${dto.paymentId}' not found`);
    }

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.paymentEvent.create({
            data: {
              paymentId: payment.id,
              provider: "TEST",
              eventType: dto.eventType,
              externalEventId: dto.externalEventId,
              payload: (dto.metadata || {}) as any,
            },
          });

          const txPayment = await tx.payment.findUnique({
            where: { id: payment.id },
            include: { order: true },
          });
          if (!txPayment) {
            throw new NotFoundException(
              `Payment '${payment.id}' not found in transaction`,
            );
          }

          if (
            txPayment.status === PaymentStatus.SUCCEEDED ||
            txPayment.status === PaymentStatus.FAILED ||
            txPayment.status === PaymentStatus.CANCELLED
          ) {
            return {
              success: true,
              duplicate: false,
              paymentStatus: txPayment.status,
              orderStatus: txPayment.order.status,
              message: `Payment already in terminal state ${txPayment.status}`,
            };
          }

          if (dto.eventType === "payment.succeeded") {
            const payCas = await tx.payment.updateMany({
              where: { id: txPayment.id, status: PaymentStatus.PENDING },
              data: { status: PaymentStatus.SUCCEEDED },
            });
            if (payCas.count === 0) {
              const current = await tx.payment.findUniqueOrThrow({
                where: { id: txPayment.id },
                include: { order: true },
              });
              return {
                success: true,
                duplicate: false,
                paymentStatus: current.status,
                orderStatus: current.order.status,
                message: `Payment already in state ${current.status}`,
              };
            }

            const orderCas = await tx.order.updateMany({
              where: {
                id: txPayment.orderId,
                status: OrderStatus.PENDING_PAYMENT,
              },
              data: { status: OrderStatus.PAID },
            });
            if (orderCas.count === 0) {
              throw new ConflictException(
                "Order is not in pending payment state; cannot transition to PAID",
              );
            }

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
          }

          if (dto.eventType === "payment.failed") {
            const payCas = await tx.payment.updateMany({
              where: { id: txPayment.id, status: PaymentStatus.PENDING },
              data: { status: PaymentStatus.FAILED },
            });
            if (payCas.count === 0) {
              const current = await tx.payment.findUniqueOrThrow({
                where: { id: txPayment.id },
                include: { order: true },
              });
              return {
                success: true,
                duplicate: false,
                paymentStatus: current.status,
                orderStatus: current.order.status,
                message: `Payment already in state ${current.status}`,
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
          }

          if (dto.eventType === "payment.cancelled") {
            const payCas = await tx.payment.updateMany({
              where: { id: txPayment.id, status: PaymentStatus.PENDING },
              data: { status: PaymentStatus.CANCELLED },
            });
            if (payCas.count === 0) {
              const current = await tx.payment.findUniqueOrThrow({
                where: { id: txPayment.id },
                include: { order: true },
              });
              return {
                success: true,
                duplicate: false,
                paymentStatus: current.status,
                orderStatus: current.order.status,
                message: `Payment already in state ${current.status}`,
              };
            }

            // Legacy Phase 4 test-provider behavior remains isolated here.
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
        },
        { maxWait: 10000, timeout: 20000 },
      );
    } catch (err: any) {
      if (this.isPaymentEventUniqueError(err)) {
        const reloaded = await prisma.payment.findUnique({
          where: { id: payment.id },
          include: { order: true },
        });
        return {
          success: true,
          duplicate: true,
          paymentStatus: reloaded?.status || payment.status,
          orderStatus: reloaded?.order?.status || payment.order.status,
          message: "Concurrent duplicate event handled idempotently",
        };
      }
      throw err;
    }
  }

  async createPaymentSession(
    userId: string,
    orderId: string,
    dto?: CreatePaymentSessionDto,
  ): Promise<PaymentSessionResponse> {
    this.validateRedirectUrl(dto?.successUrl);
    this.validateRedirectUrl(dto?.cancelUrl);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException(`Order '${orderId}' not found`);
    if (order.userId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        `Order is not in pending payment state (status: ${order.status})`,
      );
    }

    const providerName = (dto?.provider || "stripe").trim().toLowerCase();
    const adapter = this.providerFactory.getAdapter(providerName);

    let payment = order.payments.find(
      (candidate) => candidate.status === PaymentStatus.PENDING,
    );

    if (!payment) {
      try {
        payment = await prisma.payment.create({
          data: {
            orderId: order.id,
            provider: adapter.providerName,
            status: PaymentStatus.PENDING,
            amount: order.totalAmount,
            currency: order.currency,
          },
        });
      } catch (err: any) {
        if (!this.isPendingPaymentUniqueError(err)) throw err;
        payment =
          (await prisma.payment.findFirst({
            where: {
              orderId: order.id,
              status: PaymentStatus.PENDING,
            },
            orderBy: { createdAt: "asc" },
          })) || undefined;
        if (!payment) throw err;
      }
    }

    if (
      payment.providerReference &&
      payment.provider.toLowerCase() !== adapter.providerName
    ) {
      throw new ConflictException(
        `Order already has an active payment session with provider '${payment.provider}'`,
      );
    }

    if (
      payment.providerReference &&
      payment.provider.toLowerCase() === adapter.providerName
    ) {
      if (!adapter.getPaymentSession) {
        throw new BadGatewayException(
          "Existing provider session cannot be retrieved safely",
        );
      }
      const existingSession = await adapter.getPaymentSession(
        payment.providerReference,
      );
      if (!existingSession?.sessionUrl) {
        throw new BadGatewayException(
          "Existing provider session is unavailable; no URL was fabricated",
        );
      }
      return {
        sessionId: existingSession.sessionId,
        sessionUrl: existingSession.sessionUrl,
        provider: adapter.providerName,
        providerReference: existingSession.providerReference,
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

    const claim = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PENDING,
        providerReference: null,
      },
      data: {
        provider: adapter.providerName,
        providerReference: session.providerReference,
      },
    });

    if (claim.count === 0) {
      const current = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      if (
        current.status !== PaymentStatus.PENDING ||
        current.provider.toLowerCase() !== adapter.providerName ||
        current.providerReference !== session.providerReference
      ) {
        throw new ConflictException(
          "Payment session was initialized concurrently with conflicting state",
        );
      }
    }

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

  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<PaymentWebhookResponse> {
    const adapter = this.providerFactory.getAdapter(providerName);
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

    return this.processAuthoritativePaymentEvent({
      provider: adapter.providerName,
      externalEventId: normalizedEvent.externalEventId,
      paymentId: normalizedEvent.paymentId,
      orderId: normalizedEvent.orderId,
      providerReference: normalizedEvent.providerReference,
      amount: normalizedEvent.amount,
      currency: normalizedEvent.currency,
      eventType: normalizedEvent.eventType,
      rawPayloadHash: normalizedEvent.rawPayloadHash,
      sanitizedPayload: normalizedEvent.sanitizedPayload,
    });
  }

  private validateEvidenceShape(evidence: AuthoritativePaymentEvidence): void {
    if (
      !evidence.provider?.trim() ||
      !evidence.externalEventId?.trim() ||
      !evidence.paymentId?.trim() ||
      !evidence.orderId?.trim() ||
      !evidence.providerReference?.trim() ||
      !evidence.currency?.trim() ||
      !Number.isFinite(evidence.amount) ||
      !Number.isInteger(evidence.amount) ||
      evidence.amount < 0
    ) {
      throw new BadRequestException(
        "Incomplete authoritative payment evidence",
      );
    }
  }

  /**
   * Single internal mutation authority for verified provider events and
   * authoritative reconciliation results. This method is deliberately private.
   */
  private async processAuthoritativePaymentEvent(
    evidence: AuthoritativePaymentEvidence,
  ): Promise<PaymentWebhookResponse> {
    this.validateEvidenceShape(evidence);
    const provider = evidence.provider.trim().toLowerCase();

    try {
      return await prisma.$transaction(
        async (tx) => {
          // Deterministic lock order: Payment -> Order.
          await tx.$queryRawUnsafe(
            'SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE',
            evidence.paymentId,
          );
          await tx.$queryRawUnsafe(
            'SELECT "id" FROM "orders" WHERE "id" = $1 FOR UPDATE',
            evidence.orderId,
          );

          const txPayment = await tx.payment.findUnique({
            where: { id: evidence.paymentId },
            include: { order: true },
          });
          if (!txPayment) {
            throw new NotFoundException(
              `Payment '${evidence.paymentId}' not found`,
            );
          }

          if (txPayment.provider.toLowerCase() !== provider) {
            throw new BadRequestException("Payment provider mismatch");
          }
          if (txPayment.orderId !== evidence.orderId) {
            throw new BadRequestException("Payment order binding mismatch");
          }
          if (
            !txPayment.providerReference ||
            txPayment.providerReference !== evidence.providerReference
          ) {
            throw new BadRequestException("Provider reference mismatch");
          }
          if (txPayment.amount !== evidence.amount) {
            throw new BadRequestException("Payment amount mismatch");
          }
          if (
            txPayment.currency.toUpperCase() !== evidence.currency.toUpperCase()
          ) {
            throw new BadRequestException("Payment currency mismatch");
          }

          const existingEvent = await tx.paymentEvent.findUnique({
            where: {
              provider_externalEventId: {
                provider,
                externalEventId: evidence.externalEventId,
              },
            },
          });
          if (existingEvent) {
            return {
              success: true,
              duplicate: true,
              paymentStatus: txPayment.status,
              orderStatus: txPayment.order.status,
              message: "Payment event already processed",
            };
          }

          await tx.paymentEvent.create({
            data: {
              paymentId: txPayment.id,
              provider,
              eventType: evidence.eventType,
              externalEventId: evidence.externalEventId,
              payload: (evidence.sanitizedPayload || {}) as any,
              rawPayloadHash: evidence.rawPayloadHash || null,
            },
          });

          if (txPayment.status !== PaymentStatus.PENDING) {
            return {
              success: true,
              duplicate: true,
              paymentStatus: txPayment.status,
              orderStatus: txPayment.order.status,
              message: `Payment attempt is terminal (${txPayment.status}); event recorded without state mutation`,
            };
          }

          if (evidence.eventType === "payment.failed") {
            const payCas = await tx.payment.updateMany({
              where: { id: txPayment.id, status: PaymentStatus.PENDING },
              data: { status: PaymentStatus.FAILED },
            });
            if (payCas.count === 0) {
              const current = await tx.payment.findUniqueOrThrow({
                where: { id: txPayment.id },
                include: { order: true },
              });
              return {
                success: true,
                duplicate: true,
                paymentStatus: current.status,
                orderStatus: current.order.status,
                message: `Payment already transitioned to ${current.status}`,
              };
            }

            await this.auditService.logActionWithClient(tx, {
              action: "PAYMENT_FAILED",
              entity: "Payment",
              entityId: txPayment.id,
              actorId: txPayment.order.userId,
              details: {
                orderId: txPayment.orderId,
                externalEventId: evidence.externalEventId,
                provider,
              },
            });
            return {
              success: true,
              duplicate: false,
              paymentStatus: PaymentStatus.FAILED,
              orderStatus: txPayment.order.status,
              message: "Payment attempt marked as failed",
            };
          }

          if (evidence.eventType === "payment.cancelled") {
            const payCas = await tx.payment.updateMany({
              where: { id: txPayment.id, status: PaymentStatus.PENDING },
              data: { status: PaymentStatus.CANCELLED },
            });
            if (payCas.count === 0) {
              const current = await tx.payment.findUniqueOrThrow({
                where: { id: txPayment.id },
                include: { order: true },
              });
              return {
                success: true,
                duplicate: true,
                paymentStatus: current.status,
                orderStatus: current.order.status,
                message: `Payment already transitioned to ${current.status}`,
              };
            }

            // Provider-session expiry cancels only the attempt. The Order stays
            // PENDING_PAYMENT so a new immutable Payment attempt can be created.
            await this.auditService.logActionWithClient(tx, {
              action: "PAYMENT_CANCELLED",
              entity: "Payment",
              entityId: txPayment.id,
              actorId: txPayment.order.userId,
              details: {
                orderId: txPayment.orderId,
                externalEventId: evidence.externalEventId,
                provider,
              },
            });
            return {
              success: true,
              duplicate: false,
              paymentStatus: PaymentStatus.CANCELLED,
              orderStatus: txPayment.order.status,
              message:
                "Payment attempt cancelled; order remains available for retry",
            };
          }

          const payCas = await tx.payment.updateMany({
            where: { id: txPayment.id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.SUCCEEDED },
          });
          if (payCas.count === 0) {
            const current = await tx.payment.findUniqueOrThrow({
              where: { id: txPayment.id },
              include: { order: true },
            });
            return {
              success: true,
              duplicate: true,
              paymentStatus: current.status,
              orderStatus: current.order.status,
              message: `Payment already transitioned to ${current.status}`,
            };
          }

          if (txPayment.order.status === OrderStatus.PAID) {
            await this.auditService.logActionWithClient(tx, {
              action: "DUPLICATE_PAYMENT_DETECTED",
              entity: "Payment",
              entityId: txPayment.id,
              actorId: txPayment.order.userId,
              details: {
                orderId: txPayment.order.id,
                orderNumber: txPayment.order.orderNumber,
                externalEventId: evidence.externalEventId,
                provider,
                anomaly:
                  "Payment succeeded for an order that was already PAID",
              },
            });
            return {
              success: true,
              duplicate: false,
              paymentStatus: PaymentStatus.SUCCEEDED,
              orderStatus: OrderStatus.PAID,
              message:
                "Payment succeeded; order was already PAID (duplicate payment anomaly logged)",
            };
          }

          if (txPayment.order.status !== OrderStatus.PENDING_PAYMENT) {
            throw new ConflictException(
              `Order '${txPayment.orderId}' is in state ${txPayment.order.status}, cannot transition to PAID`,
            );
          }

          const orderCas = await tx.order.updateMany({
            where: {
              id: txPayment.orderId,
              status: OrderStatus.PENDING_PAYMENT,
            },
            data: { status: OrderStatus.PAID },
          });
          if (orderCas.count === 0) {
            const currentOrder = await tx.order.findUniqueOrThrow({
              where: { id: txPayment.orderId },
            });
            if (currentOrder.status === OrderStatus.PAID) {
              await this.auditService.logActionWithClient(tx, {
                action: "DUPLICATE_PAYMENT_DETECTED",
                entity: "Payment",
                entityId: txPayment.id,
                actorId: txPayment.order.userId,
                details: {
                  orderId: txPayment.order.id,
                  orderNumber: txPayment.order.orderNumber,
                  externalEventId: evidence.externalEventId,
                  provider,
                  anomaly: "Order transitioned to PAID concurrently",
                },
              });
              return {
                success: true,
                duplicate: false,
                paymentStatus: PaymentStatus.SUCCEEDED,
                orderStatus: OrderStatus.PAID,
                message: "Order was marked PAID concurrently",
              };
            }
            throw new ConflictException(
              `Order '${txPayment.orderId}' cannot transition to PAID`,
            );
          }

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
              externalEventId: evidence.externalEventId,
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
        },
        { maxWait: 10000, timeout: 20000 },
      );
    } catch (err: any) {
      if (this.isPaymentEventUniqueError(err)) {
        const reloaded = await prisma.payment.findUnique({
          where: { id: evidence.paymentId },
          include: { order: true },
        });
        return {
          success: true,
          duplicate: true,
          paymentStatus: reloaded?.status || PaymentStatus.PENDING,
          orderStatus: reloaded?.order?.status || OrderStatus.PENDING_PAYMENT,
          message: "Concurrent duplicate event handled idempotently",
        };
      }
      throw err;
    }
  }

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
        message: `Payment is already in terminal state ${payment.status}`,
      };
    }

    const adapter = this.providerFactory.getAdapter(payment.provider);
    if (payment.provider.toLowerCase() !== adapter.providerName) {
      throw new BadRequestException("Payment provider mismatch");
    }
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

    if (statusResult.providerReference !== payment.providerReference) {
      throw new BadRequestException("Provider reference mismatch in reconciliation");
    }
    if (statusResult.amount !== payment.amount) {
      throw new BadRequestException("Amount mismatch in reconciliation");
    }
    if (statusResult.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      throw new BadRequestException("Currency mismatch in reconciliation");
    }

    if (
      statusResult.status !== PaymentStatus.SUCCEEDED &&
      statusResult.status !== PaymentStatus.CANCELLED &&
      statusResult.status !== PaymentStatus.FAILED
    ) {
      return {
        success: true,
        transitioned: false,
        paymentStatus: payment.status,
        orderStatus: payment.order.status,
        message: `Provider status is '${statusResult.status}', no transition required`,
      };
    }

    const reason = dto?.reason || PaymentReconcileReason.AUTHORITATIVE_QUERY;
    const externalEventId =
      statusResult.externalEventId ||
      `reconcile_${payment.providerReference}_${statusResult.status.toLowerCase()}`;
    const eventType =
      statusResult.status === PaymentStatus.SUCCEEDED
        ? "payment.succeeded"
        : statusResult.status === PaymentStatus.CANCELLED
          ? "payment.cancelled"
          : "payment.failed";

    const result = await this.processAuthoritativePaymentEvent({
      provider: adapter.providerName,
      externalEventId,
      paymentId: payment.id,
      orderId: payment.orderId,
      providerReference: statusResult.providerReference,
      amount: statusResult.amount,
      currency: statusResult.currency,
      eventType,
      sanitizedPayload: {
        reconciled: true,
        reconciledAt: new Date().toISOString(),
        reason,
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

  async getPayment(id: string, user?: AuthUser): Promise<PaymentDto> {
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { order: true },
    });
    if (!payment) {
      throw new NotFoundException(`Payment '${id}' not found`);
    }

    if (user) {
      const isStaff =
        user.permissions?.includes("payment.read") ||
        user.roles?.includes("admin") ||
        user.roles?.includes("super_admin") ||
        user.roles?.includes("finance") ||
        user.roles?.includes("ops");
      if (!isStaff && payment.order.userId !== user.id) {
        throw new NotFoundException(`Payment '${id}' not found`);
      }

      let metadata = payment.metadata as Record<string, any> | null;
      if (!isStaff && metadata) {
        const { clientSecret, rawToken, internalHash, ...safeMetadata } =
          metadata;
        metadata = safeMetadata;
      }

      return {
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        providerReference: payment.providerReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        metadata,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      };
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
