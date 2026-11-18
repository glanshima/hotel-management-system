-- Migration: 0005_create_reservations
-- (c)SIDGAKS Tech
-- Purpose: Central booking entity. Tracks the full guest stay lifecycle.
-- room_id is nullable: reservation may be created before a specific room is assigned.
-- rate_per_night_minor is locked at booking time and must not change after creation.

CREATE TABLE reservations (
  id                    TEXT    NOT NULL PRIMARY KEY,
  guest_id              TEXT    NOT NULL REFERENCES guests     (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  room_type_id          TEXT    NOT NULL REFERENCES room_types (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  room_id               TEXT             REFERENCES rooms      (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  booking_source        TEXT    NOT NULL
                                 CHECK (booking_source IN ('online', 'reception', 'phone', 'email', 'ota', 'other')),
  status                TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  checkin_date          TEXT    NOT NULL,
  checkout_date         TEXT    NOT NULL,
  num_adults            INTEGER NOT NULL DEFAULT 1  CHECK (num_adults >= 1),
  num_children          INTEGER NOT NULL DEFAULT 0  CHECK (num_children >= 0),
  rate_per_night_minor  INTEGER NOT NULL             CHECK (rate_per_night_minor >= 0),
  currency_code         TEXT    NOT NULL,
  special_requests      TEXT,
  -- created_by references users.id (Phase B). No FK constraint until users table exists.
  created_by            TEXT,
  confirmed_at          TEXT,
  cancelled_at          TEXT,
  cancellation_reason   TEXT,
  noshow_at             TEXT,
  checked_in_at         TEXT,
  checked_out_at        TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  -- checkout_date must be strictly after checkin_date (table-level constraint)
  CHECK (checkout_date > checkin_date)
);

CREATE INDEX idx_reservations_guest_id      ON reservations (guest_id);
CREATE INDEX idx_reservations_room_id       ON reservations (room_id);
CREATE INDEX idx_reservations_room_type_id  ON reservations (room_type_id);
CREATE INDEX idx_reservations_dates         ON reservations (checkin_date, checkout_date);
CREATE INDEX idx_reservations_status        ON reservations (status);
