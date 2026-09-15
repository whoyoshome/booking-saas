-- Step 5: Row Level Security on users.
-- FORCE is required because the app connects as booking_admin, which owns
-- the table; without FORCE, PostgreSQL exempts the table owner from RLS.
--
-- tenant_id is TEXT (Prisma String), not uuid — compare as text.
-- NULLIF(..., ''): current_setting(name, true) returns '' when the GUC
-- was never set; comparing against that yields zero rows instead of an error.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
