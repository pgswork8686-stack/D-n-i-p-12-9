-- Phase 19 — read-only PostgreSQL role for Apache Superset (BI) and future Superset MCP.
--
-- Grants SELECT on the analytics schema ONLY. The role cannot read commerce/auth tables in
-- "public" (users, orders, payments, licenses...), cannot write anything and cannot create
-- objects. Run as a superuser / database owner:
--
--   psql "$DATABASE_URL" -v ro_password="$ANALYTICS_RO_PASSWORD" -f infra/superset/sql/create-readonly-role.sql
--
-- The password is passed as a psql variable at runtime; it is never stored in this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'superset_ro') THEN
    CREATE ROLE superset_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;

ALTER ROLE superset_ro WITH PASSWORD :'ro_password';
ALTER ROLE superset_ro SET statement_timeout = '30s';
ALTER ROLE superset_ro SET default_transaction_read_only = on;
ALTER ROLE superset_ro SET search_path = analytics;

-- No access to anything in public (commerce, identity, licenses, payments).
REVOKE ALL ON SCHEMA public FROM superset_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM superset_ro;

-- Read-only access to the marketing warehouse.
GRANT USAGE ON SCHEMA analytics TO superset_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO superset_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO superset_ro;
