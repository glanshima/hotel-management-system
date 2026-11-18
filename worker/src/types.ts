/**
 * Shared TypeScript types for the Hotel Management System.
 * All database rows are represented as plain interfaces.
 * Monetary values use integer minor-unit representation (e.g. satang for THB).
 * All timestamps are stored and returned as ISO 8601 UTC strings.
 */

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------

export interface HotelConfig {
  id: 'hotel';
  hotel_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  country: string;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  currency_code: string;
  timezone: string;
  checkin_time: string;
  checkout_time: string;
  noshow_cutoff_time: string;
  default_cancellation_hours: number;
  created_at: string;
  updated_at: string;
}

export interface RoomType {
  id: string;
  name: string;
  description: string | null;
  base_rate_minor: number;
  currency_code: string;
  max_occupancy: number;
  bed_count: number;
  bed_type: string | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'out_of_order';

export interface Room {
  id: string;
  room_type_id: string;
  room_number: string;
  floor: number | null;
  status: RoomStatus;
  description: string | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export type GuestIdType = 'passport' | 'national_id' | 'drivers_license' | 'other';

export interface Guest {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  id_type: GuestIdType | null;
  id_number: string | null;
  nationality: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show';

export type BookingSource = 'online' | 'reception' | 'phone' | 'email' | 'ota' | 'other';

export interface Reservation {
  id: string;
  guest_id: string;
  room_type_id: string;
  room_id: string | null;
  booking_source: BookingSource;
  status: ReservationStatus;
  checkin_date: string;   // YYYY-MM-DD
  checkout_date: string;  // YYYY-MM-DD
  num_adults: number;
  num_children: number;
  rate_per_night_minor: number;
  currency_code: string;
  special_requests: string | null;
  created_by: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  noshow_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReservationStatusLog {
  id: string;
  reservation_id: string;
  from_status: ReservationStatus | null;
  to_status: ReservationStatus;
  changed_by: string | null;
  reason: string | null;
  changed_at: string;
}

// ---------------------------------------------------------------------------
// Cloudflare Worker environment bindings
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// API error shape
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Status transition table
// ---------------------------------------------------------------------------

/** Valid transitions: ALLOWED_TRANSITIONS[from] = set of allowed `to` values. */
export const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending:     ['confirmed', 'cancelled'],
  confirmed:   ['checked_in', 'cancelled', 'no_show'],
  checked_in:  ['checked_out'],
  checked_out: [],
  cancelled:   [],
  no_show:     [],
};
