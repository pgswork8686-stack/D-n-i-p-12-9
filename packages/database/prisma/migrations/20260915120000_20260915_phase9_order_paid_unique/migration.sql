-- Deduplicate any historical duplicate ORDER_PAID outbox events (keep the earliest row per order)
DELETE FROM "outbox_events"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "aggregate_id"
             ORDER BY "created_at" ASC, "id" ASC
           ) as rn
    FROM "outbox_events"
    WHERE "aggregate_type" = 'Order' AND "event_type" = 'ORDER_PAID'
  ) t
  WHERE t.rn > 1
);

-- Phase 9: Order-level exactly-once authority for ORDER_PAID outbox events
CREATE UNIQUE INDEX IF NOT EXISTS "unique_order_paid_outbox" 
ON "outbox_events" ("aggregate_id") 
WHERE "aggregate_type" = 'Order' AND "event_type" = 'ORDER_PAID';
