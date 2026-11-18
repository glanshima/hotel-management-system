-- Migration: 0001_create_hotel_config
-- Purpose: Hotel instance configuration singleton table.
-- One row per deployment, enforced by PRIMARY KEY + CHECK constraint.

CREATE TABLE hotel_config (
  id                           TEXT    NOT NULL PRIMARY KEY CHECK (id = 'hotel'),
  hotel_name                   TEXT    NOT NULL,
  address_line1                TEXT    NOT NULL,
  address_line2                TEXT,
  city                         TEXT    NOT NULL,
  country                      TEXT    NOT NULL,
  postal_code                  TEXT,
  phone                        TEXT,
  email                        TEXT,
  currency_code                TEXT    NOT NULL DEFAULT 'THB',
  timezone                     TEXT    NOT NULL DEFAULT 'Asia/Bangkok',
  checkin_time                 TEXT    NOT NULL DEFAULT '14:00'
                                        CHECK (checkin_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  checkout_time                TEXT    NOT NULL DEFAULT '12:00'
                                        CHECK (checkout_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  noshow_cutoff_time           TEXT    NOT NULL DEFAULT '23:00'
                                        CHECK (noshow_cutoff_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  default_cancellation_hours   INTEGER NOT NULL DEFAULT 24
                                        CHECK (default_cancellation_hours > 0),
  created_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT    NOT NULL DEFAULT (datetime('now'))
);
