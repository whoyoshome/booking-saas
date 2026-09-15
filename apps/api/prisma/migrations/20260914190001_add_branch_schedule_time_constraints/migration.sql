-- Phase 5 Step 3: time-order CHECKs for branch schedules (no overnight spans in v1).

ALTER TABLE branch_schedules
  ADD CONSTRAINT branch_schedules_time_order CHECK (end_time > start_time);

ALTER TABLE branch_schedule_exceptions
  ADD CONSTRAINT branch_schedule_exceptions_time_order
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
