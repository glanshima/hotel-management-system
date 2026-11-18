-- Migration: 0006_create_reservation_status_log
-- Purpose: Immutable audit trail of every reservation status transition.
-- Rows must never be updated or deleted by the application.
-- Cascade delete is intentional: log entries have no meaning without their reservation.

CREATE TABLE reservation_status_log (
  id              TEXT NOT NULL PRIMARY KEY,
  reservation_id  TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE ON UPDATE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  -- changed_by references users.id (Phase B). No FK constraint until users table exists.
  changed_by      TEXT,
  reason          TEXT,
  changed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reservation_status_log_reservation_id ON reservation_status_log (reservation_id);
