import { IsString, IsEnum, IsOptional, IsObject } from "class-validator";

export enum TestPaymentEventType {
  SUCCEEDED = "payment.succeeded",
  FAILED = "payment.failed",
  CANCELLED = "payment.cancelled",
}

export class TestPaymentCallbackDto {
  @IsString()
  paymentId!: string;

  @IsString()
  externalEventId!: string;

  @IsEnum(TestPaymentEventType)
  eventType!: "payment.succeeded" | "payment.failed" | "payment.cancelled";

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreatePaymentSessionDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}

export class ReconcilePaymentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

