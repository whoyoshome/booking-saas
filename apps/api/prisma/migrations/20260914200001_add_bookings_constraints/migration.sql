-- Phase 6: CHECK + exclusion constraint (anti-double-booking).
-- btree_gist must already be enabled (Fase 1 docker/postgres/init.sql).

ALTER TABLE bookings
  ADD CONSTRAINT bookings_time_order CHECK (end_time > start_time);

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED'));
