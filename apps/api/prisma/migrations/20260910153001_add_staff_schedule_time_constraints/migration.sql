-- Phase 5 Step 1: time-order CHECKs (no overnight spans in v1).
-- Prisma does not express multi-column CHECKs natively in all versions.

ALTER TABLE staff_schedules
  ADD CONSTRAINT staff_schedules_time_order CHECK (end_time > start_time);

ALTER TABLE staff_schedule_exceptions
  ADD CONSTRAINT staff_schedule_exceptions_time_order
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
