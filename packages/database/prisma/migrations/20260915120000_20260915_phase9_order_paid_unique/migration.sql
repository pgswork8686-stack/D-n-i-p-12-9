-- Phase 9: fail closed if historical data violates the new business invariants.
-- Do NOT delete payment/fulfillment history automatically in a schema migration.
DO $$
DECLARE
  duplicate_order_paid_count INTEGER;
  duplicate_pending_payment_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_order_paid_count
  FROM (
    SELECT "aggregate_id"
    FROM "outbox_events"
    WHERE "aggregate_type" = 'Order' AND "event_type" = 'ORDER_PAID'
    GROUP BY "aggregate_id"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_order_paid_count > 0 THEN
    RAISE EXCEPTION
      'Phase 9 migration blocked: % orders have duplicate ORDER_PAID outbox history; run an explicit audited data repair before retrying',
      duplicate_order_paid_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_pending_payment_count
  FROM (
    SELECT "order_id"
    FROM "payments"
    WHERE "status" = 'PENDING'
    GROUP BY "order_id"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_pending_payment_count > 0 THEN
    RAISE EXCEPTION
      'Phase 9 migration blocked: % orders have more than one PENDING payment attempt; run an explicit audited data repair before retrying',
      duplicate_pending_payment_count;
  END IF;
END $$;

-- Order-level exactly-once authority for ORDER_PAID business events.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_order_paid_outbox"
ON "outbox_events" ("aggregate_id")
WHERE "aggregate_type" = 'Order' AND "event_type" = 'ORDER_PAID';

-- At most one active PENDING payment attempt may exist for an Order.
-- FAILED/CANCELLED attempts remain immutable history and a retry creates a new Payment row.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_pending_payment_per_order"
ON "payments" ("order_id")
WHERE "status" = 'PENDING';
