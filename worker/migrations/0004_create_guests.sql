-- Migration: 0004_create_guests
-- Purpose: Guest profile records.
-- Persists across reservations. Email uniqueness guard for deduplication.

CREATE TABLE guests (
  id            TEXT NOT NULL PRIMARY KEY,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT UNIQUE,
  phone         TEXT,
  id_type       TEXT CHECK (id_type IN ('passport', 'national_id', 'drivers_license', 'other')),
  id_number     TEXT,
  nationality   TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  country       TEXT,
  postal_code   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_guests_email     ON guests (email);
CREATE INDEX idx_guests_last_name ON guests (last_name);
