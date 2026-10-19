-- A transfer larger than 2,147,483,647 (INT4 max) must still be storable: if the case cannot be saved the
-- webhook is (correctly) not acknowledged, so an INT4 overflow would make the provider retry forever.
ALTER TABLE "payment_reconciliation_cases" ALTER COLUMN "expected_amount" TYPE BIGINT;
ALTER TABLE "payment_reconciliation_cases" ALTER COLUMN "received_amount" TYPE BIGINT;
