-- Phase 4 Step 1: RLS on branches (same pattern as users in Phase 3 Step 5).
-- tenant_id is TEXT — compare as text, no ::uuid cast.

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branches
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
