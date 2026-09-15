-- Phase 5 Step 3: RLS on branch_schedules + branch_schedule_exceptions.
-- tenant_id is TEXT — compare as text, no ::uuid cast.

ALTER TABLE branch_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branch_schedules
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );

ALTER TABLE branch_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_schedule_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branch_schedule_exceptions
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
