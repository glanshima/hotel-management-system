-- Migration: 0002_create_room_types
-- Purpose: Room category definitions (Standard, Deluxe, Suite, etc.).
-- Drives pricing and availability at the category level.

CREATE TABLE room_types (
  id               TEXT    NOT NULL PRIMARY KEY,
  name             TEXT    NOT NULL UNIQUE,
  description      TEXT,
  base_rate_minor  INTEGER NOT NULL CHECK (base_rate_minor >= 0),
  currency_code    TEXT    NOT NULL,
  max_occupancy    INTEGER NOT NULL CHECK (max_occupancy >= 1),
  bed_count        INTEGER NOT NULL CHECK (bed_count >= 1),
  bed_type         TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
