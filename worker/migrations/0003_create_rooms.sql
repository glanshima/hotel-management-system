-- Migration: 0003_create_rooms
-- Purpose: Physical rooms in the hotel.
-- Each room belongs to a room type and carries a current operational status.

CREATE TABLE rooms (
  id            TEXT    NOT NULL PRIMARY KEY,
  room_type_id  TEXT    NOT NULL REFERENCES room_types (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  room_number   TEXT    NOT NULL UNIQUE,
  floor         INTEGER,
  status        TEXT    NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance', 'out_of_order')),
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rooms_room_type_id ON rooms (room_type_id);
CREATE INDEX idx_rooms_status       ON rooms (status);
