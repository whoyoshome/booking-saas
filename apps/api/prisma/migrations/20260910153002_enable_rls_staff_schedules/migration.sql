-- Phase 5 Step 1: RLS on staff_schedules + staff_schedule_exceptions.
-- tenant_id is TEXT — compare as text, no ::uuid cast.

ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_schedules
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );

ALTER TABLE staff_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedule_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_schedule_exceptions
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
