-- Adds the booking_app role to an existing database. init.sql only runs on
-- an empty data directory, so older local volumes need this once.
-- Idempotent: safe to run more than once.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'booking_app') THEN
    CREATE ROLE booking_app WITH LOGIN PASSWORD 'change_me_local_only_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO booking_app;

-- Existing tables need an explicit grant; ALTER DEFAULT PRIVILEGES below
-- only covers tables created after it runs.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO booking_app;

ALTER DEFAULT PRIVILEGES FOR ROLE booking_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO booking_app;
