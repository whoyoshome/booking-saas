-- Runs once, when the Postgres data directory is first created.
--
-- btree_gist lets a GiST index combine plain equality (staff_id) with a
-- range (time_range); the bookings exclusion constraint depends on it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Runtime role for the API. POSTGRES_USER (booking_admin) is a superuser,
-- and superusers bypass Row Level Security even with FORCE ROW LEVEL
-- SECURITY. booking_admin is therefore reserved for migrations and admin
-- scripts; the API connects as booking_app, which owns no tables and is
-- subject to RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'booking_app') THEN
    CREATE ROLE booking_app WITH LOGIN PASSWORD 'change_me_local_only_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO booking_app;

-- Every table booking_admin creates from now on (i.e. every Prisma
-- migration) grants these privileges to booking_app automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE booking_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO booking_app;
