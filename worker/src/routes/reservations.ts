/**
 * Routes: Reservations
 * (c)SIDGAKS Tech
 *
 * GET    /reservations                           — List reservations
 * POST   /reservations                           — Create a reservation
 * GET    /reservations/:id                       — Get a specific reservation
 * PATCH  /reservations/:id/confirm               — Confirm a pending reservation
 * PATCH  /reservations/:id/cancel                — Cancel a pending or confirmed reservation
 * PATCH  /reservations/:id/no-show               — Mark as no-show (after configured cutoff)
 * PATCH  /reservations/:id/check-in              — Check in (from configured check-in time)
 * PATCH  /reservations/:id/check-out             — Check out (early checkout permitted)
 * PATCH  /reservations/:id/assign-room           — Assign a specific room
 * GET    /reservations/:id/status-log            — Status transition history
 *
 * DEVELOPMENT NOTE:
 * This API has no authentication or authorisation layer. It must NOT be
 * exposed as a public production service until Phase B authentication is
 * implemented. All endpoints listed above require staff authorisation in
 * production. See docs/developer-setup.md §Authentication Boundary.
 */

import { json, notFound, badRequest, conflict, unprocessable, parseBody } from '../router';
import {
  getReservation,
  listReservations,
  createReservation,
  transitionReservation,
  assignRoomToReservation,
  getStatusLog,
  getGuest,
  getRoomType,
  getRoom,
  getHotelConfig,
  countActiveRoomsByType,
  countOverlappingReservationsByType,
  hasRoomConflict,
  CapacityExceededError,
  localTimeHHMM,
  localDateYMD,
} from '../db';
import type { Env, ReservationStatus, BookingSource } from '../types';
import { ALLOWED_TRANSITIONS } from '../types';

// YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns true only if the string is a syntactically and calendrically valid date. */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

type Handler = (req: Request, params: Record<string, string>, env: Env) => Promise<Response>;

// ---------------------------------------------------------------------------
// List reservations
// ---------------------------------------------------------------------------

export const listReservationsHandler: Handler = async (req, _params, env) => {
  const url = new URL(req.url);
  const guestId = url.searchParams.get('guestId') ?? undefined;
  const status = url.searchParams.get('status') as ReservationStatus | undefined;
  const date = url.searchParams.get('date') ?? undefined;

  if (date && !isValidDate(date)) return badRequest('date must be a valid YYYY-MM-DD calendar date');

  const reservations = await listReservations(env.DB, { guestId, status, date });
  return json(reservations);
};

// ---------------------------------------------------------------------------
// Get reservation
// ---------------------------------------------------------------------------

export const getReservationHandler: Handler = async (_req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');
  return json(reservation);
};

// ---------------------------------------------------------------------------
// Create reservation
// ---------------------------------------------------------------------------

export const createReservationHandler: Handler = async (req, _params, env) => {
  type Body = {
    guest_id: string;
    room_type_id: string;
    room_id?: string;
    booking_source: BookingSource;
    checkin_date: string;
    checkout_date: string;
    num_adults?: number;
    num_children?: number;
    rate_per_night_minor: number;
    currency_code?: string;
    special_requests?: string;
    created_by?: string;
  };

  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');

  if (!body.guest_id || typeof body.guest_id !== 'string')
    return badRequest('guest_id is required');
  if (!body.room_type_id || typeof body.room_type_id !== 'string')
    return badRequest('room_type_id is required');
  if (!body.booking_source || typeof body.booking_source !== 'string')
    return badRequest('booking_source is required');

  if (!body.checkin_date || !isValidDate(body.checkin_date))
    return badRequest('checkin_date must be a valid YYYY-MM-DD calendar date');
  if (!body.checkout_date || !isValidDate(body.checkout_date))
    return badRequest('checkout_date must be a valid YYYY-MM-DD calendar date');
  if (body.checkout_date <= body.checkin_date)
    return badRequest('checkout_date must be after checkin_date');

  if (typeof body.rate_per_night_minor !== 'number'
    || !Number.isInteger(body.rate_per_night_minor)
    || body.rate_per_night_minor < 0)
    return badRequest('rate_per_night_minor must be a non-negative integer');

  const numAdults = body.num_adults ?? 1;
  const numChildren = body.num_children ?? 0;

  if (!Number.isInteger(numAdults) || numAdults < 1)
    return badRequest('num_adults must be a positive integer');
  if (!Number.isInteger(numChildren) || numChildren < 0)
    return badRequest('num_children must be a non-negative integer');

  const VALID_SOURCES: BookingSource[] = ['online', 'reception', 'phone', 'email', 'ota', 'other'];
  if (!VALID_SOURCES.includes(body.booking_source))
    return badRequest(`booking_source must be one of: ${VALID_SOURCES.join(', ')}`);

  // Verify guest and room type exist
  const [guest, roomType, config] = await Promise.all([
    getGuest(env.DB, body.guest_id),
    getRoomType(env.DB, body.room_type_id),
    getHotelConfig(env.DB),
  ]);

  if (!guest) return badRequest('guest_id does not exist');
  if (!roomType) return badRequest('room_type_id does not exist');
  if (!roomType.is_active) return badRequest('room_type is not available for booking');

  // Occupancy check
  const totalOccupancy = numAdults + numChildren;
  if (totalOccupancy > roomType.max_occupancy) {
    return badRequest(
      `Total occupancy (${totalOccupancy}) exceeds the maximum for this room type (${roomType.max_occupancy})`,
    );
  }

  const totalRooms = await countActiveRoomsByType(env.DB, body.room_type_id);

  // If a specific room is requested, validate it before the atomic insert
  if (body.room_id) {
    const room = await getRoom(env.DB, body.room_id);
    if (!room) return badRequest('room_id does not exist');
    if (!room.is_active) return badRequest('The specified room is not active');
    if (room.room_type_id !== body.room_type_id)
      return badRequest('The specified room does not belong to the requested room type');

    const hasConflict = await hasRoomConflict(
      env.DB, body.room_id, body.checkin_date, body.checkout_date,
    );
    if (hasConflict) return conflict('The specified room is not available for the requested dates');
  }

  const currency = body.currency_code?.trim().toUpperCase() ?? config?.currency_code ?? 'THB';

  try {
    const reservation = await createReservation(
      env.DB,
      {
        guest_id: body.guest_id,
        room_type_id: body.room_type_id,
        room_id: body.room_id ?? null,
        booking_source: body.booking_source,
        checkin_date: body.checkin_date,
        checkout_date: body.checkout_date,
        num_adults: numAdults,
        num_children: numChildren,
        rate_per_night_minor: body.rate_per_night_minor,
        currency_code: currency,
        special_requests: body.special_requests ?? null,
        created_by: body.created_by ?? null,
      },
      totalRooms,
    );
    return json(reservation, 201);
  } catch (err) {
    if (err instanceof CapacityExceededError) {
      return conflict('No rooms of this type are available for the requested dates');
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Confirm reservation
// ---------------------------------------------------------------------------

export const confirmReservationHandler: Handler = async (req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  if (!ALLOWED_TRANSITIONS[reservation.status].includes('confirmed')) {
    return unprocessable(
      `Cannot confirm a reservation with status '${reservation.status}'`,
    );
  }

  // Re-validate room-type capacity at confirmation time
  const [totalRooms, roomType] = await Promise.all([
    countActiveRoomsByType(env.DB, reservation.room_type_id),
    getRoomType(env.DB, reservation.room_type_id),
  ]);
  if (!roomType || !roomType.is_active) {
    return unprocessable('The room type is no longer available');
  }

  // Count overlapping active reservations (exclude self) to guard capacity
  const overlapping = await countOverlappingReservationsByType(
    env.DB, reservation.room_type_id,
    reservation.checkin_date, reservation.checkout_date,
    reservation.id,
  );
  if (overlapping >= totalRooms) {
    return conflict(
      'Cannot confirm: no rooms of this type remain available for the requested dates',
    );
  }

  // If a specific room is assigned, re-check it
  if (reservation.room_id) {
    const room = await getRoom(env.DB, reservation.room_id);
    if (!room || !room.is_active) {
      return unprocessable('The assigned room is no longer available');
    }
    if (room.room_type_id !== reservation.room_type_id) {
      return unprocessable('The assigned room does not match the reservation room type');
    }
    const hasConflict = await hasRoomConflict(
      env.DB, reservation.room_id,
      reservation.checkin_date, reservation.checkout_date,
      reservation.id,
    );
    if (hasConflict) {
      return conflict('The assigned room has a conflicting reservation');
    }
  }

  const body = await parseBody<{ changed_by?: string; reason?: string }>(req) ?? {};
  const updated = await transitionReservation(env.DB, reservation.id, 'confirmed', {
    changedBy: body.changed_by,
    reason: body.reason ?? 'Manually confirmed',
  });
  return json(updated);
};

// ---------------------------------------------------------------------------
// Cancel reservation
// ---------------------------------------------------------------------------

export const cancelReservationHandler: Handler = async (req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  if (!ALLOWED_TRANSITIONS[reservation.status].includes('cancelled')) {
    return unprocessable(
      `Cannot cancel a reservation with status '${reservation.status}'`,
    );
  }

  const body = await parseBody<{ changed_by?: string; cancellation_reason?: string }>(req) ?? {};
  const updated = await transitionReservation(env.DB, reservation.id, 'cancelled', {
    changedBy: body.changed_by,
    cancellationReason: body.cancellation_reason,
    reason: body.cancellation_reason ?? 'Cancelled',
  });
  return json(updated);
};

// ---------------------------------------------------------------------------
// No-show
// ---------------------------------------------------------------------------

export const noShowReservationHandler: Handler = async (req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  if (!ALLOWED_TRANSITIONS[reservation.status].includes('no_show')) {
    return unprocessable(
      `Cannot mark a reservation as no-show with status '${reservation.status}'`,
    );
  }

  const config = await getHotelConfig(env.DB);
  const hotelTz = config?.timezone ?? 'Asia/Bangkok';
  const noShowCutoff = config?.noshow_cutoff_time ?? '23:00';

  const todayLocal = localDateYMD(hotelTz);
  const timeLocal = localTimeHHMM(hotelTz);

  if (reservation.checkin_date !== todayLocal) {
    return unprocessable(
      `No-show can only be marked on the reservation's check-in date (${reservation.checkin_date}). Today is ${todayLocal}.`,
    );
  }

  if (timeLocal < noShowCutoff) {
    return unprocessable(
      `No-show cannot be marked before ${noShowCutoff} hotel local time. Current time: ${timeLocal}.`,
    );
  }

  const body = await parseBody<{ changed_by?: string }>(req) ?? {};
  const updated = await transitionReservation(env.DB, reservation.id, 'no_show', {
    changedBy: body.changed_by,
    reason: 'Guest did not arrive by no-show cutoff time',
  });
  return json(updated);
};

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export const checkInHandler: Handler = async (req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  if (!ALLOWED_TRANSITIONS[reservation.status].includes('checked_in')) {
    return unprocessable(
      `Cannot check in a reservation with status '${reservation.status}'`,
    );
  }

  const config = await getHotelConfig(env.DB);
  const hotelTz = config?.timezone ?? 'Asia/Bangkok';
  const checkinTime = config?.checkin_time ?? '14:00';
  const timeLocal = localTimeHHMM(hotelTz);

  // Enforce check-in time. Staff may pass staff_override: true for early arrivals.
  const body = await parseBody<{ room_id?: string; changed_by?: string; staff_override?: boolean }>(req) ?? {};

  if (timeLocal < checkinTime && !body.staff_override) {
    return unprocessable(
      `Check-in is not permitted before ${checkinTime} hotel local time. Current time: ${timeLocal}. ` +
      `Pass staff_override: true to override (requires authorised staff — authentication not yet implemented).`,
    );
  }

  // Determine room
  const roomId = body.room_id ?? reservation.room_id;
  if (!roomId) {
    return unprocessable('A room must be assigned before check-in');
  }

  const room = await getRoom(env.DB, roomId);
  if (!room) return badRequest('room_id does not exist');
  if (!room.is_active) return unprocessable('The assigned room is not active');

  // Room must belong to the reservation's room type
  if (room.room_type_id !== reservation.room_type_id) {
    return unprocessable(
      'The assigned room does not belong to the reservation\'s room type',
    );
  }

  // Room must be available (cleaned and marked ready — approved same-day turnover rule)
  if (room.status !== 'available') {
    return unprocessable(
      `Room ${room.room_number} is not ready for check-in (current status: '${room.status}'). ` +
      `The room must be cleaned and marked 'available' before check-in.`,
    );
  }

  // If a different room is being substituted at check-in, verify no conflict
  if (body.room_id && body.room_id !== reservation.room_id) {
    const hasConflict = await hasRoomConflict(
      env.DB, body.room_id,
      reservation.checkin_date, reservation.checkout_date,
      reservation.id,
    );
    if (hasConflict) return conflict('The specified room has a conflicting reservation');
  }

  const updated = await transitionReservation(env.DB, reservation.id, 'checked_in', {
    changedBy: body.changed_by,
    roomId,
    reason: 'Guest checked in',
  });
  return json(updated);
};

// ---------------------------------------------------------------------------
// Check-out
// ---------------------------------------------------------------------------

export const checkOutHandler: Handler = async (req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  if (!ALLOWED_TRANSITIONS[reservation.status].includes('checked_out')) {
    return unprocessable(
      `Cannot check out a reservation with status '${reservation.status}'`,
    );
  }

  // Early checkout is permitted — no time enforcement on checkout.
  // The 12:00 deadline is the normal checkout time; early departure is allowed.

  const body = await parseBody<{ changed_by?: string }>(req) ?? {};
  const updated = await transitionReservation(env.DB, reservation.id, 'checked_out', {
    changedBy: body.changed_by,
    reason: 'Guest checked out',
  });
  return json(updated);
};

// ---------------------------------------------------------------------------
// Assign room
// ---------------------------------------------------------------------------

export const assignRoomHandler: Handler = async (req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  if (!['pending', 'confirmed'].includes(reservation.status)) {
    return unprocessable(
      `Cannot assign a room to a reservation with status '${reservation.status}'`,
    );
  }

  const body = await parseBody<{ room_id: string }>(req);
  if (!body?.room_id) return badRequest('room_id is required');

  const room = await getRoom(env.DB, body.room_id);
  if (!room) return badRequest('room_id does not exist');
  if (!room.is_active) return badRequest('The specified room is not active');
  if (room.room_type_id !== reservation.room_type_id) {
    return badRequest('The specified room does not belong to the reservation\'s room type');
  }

  const hasConflict = await hasRoomConflict(
    env.DB, body.room_id,
    reservation.checkin_date, reservation.checkout_date,
    reservation.id,
  );
  if (hasConflict) return conflict('The specified room has a conflicting reservation for these dates');

  const updated = await assignRoomToReservation(env.DB, reservation.id, body.room_id);
  if (!updated) return notFound('Reservation');
  return json(updated);
};

// ---------------------------------------------------------------------------
// Status log
// ---------------------------------------------------------------------------

export const statusLogHandler: Handler = async (_req, params, env) => {
  const reservation = await getReservation(env.DB, params['id']!);
  if (!reservation) return notFound('Reservation');

  const log = await getStatusLog(env.DB, reservation.id);
  return json(log);
};
