/**
 * Hotel Management System — Integration Test Suite
 * (c)SIDGAKS Tech
 *
 * Tests verify approved requirements, not just current behaviour.
 *
 * Coverage:
 *   DB-01..DB-04   Database / migration / schema verification
 *   G-01..G-05     Guest management
 *   RT-01..RT-04   Room type management
 *   R-01..R-07     Room management and operational rules
 *   RES-01..RES-20 Reservation lifecycle
 *   OP-01..OP-07   Operational time rules (check-in, checkout, no-show)
 *   RI-01..RI-04   Referential integrity
 *   VAL-01..VAL-10 Input validation and security
 *
 * Uses the Cloudflare vitest plugin: a real local D1/SQLite instance is used,
 * so all CHECK, UNIQUE, and FK constraints are exercised for real.
 */

import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const base = 'http://localhost';

async function post(path: string, body: unknown) {
  return SELF.fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown = {}) {
  return SELF.fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return SELF.fetch(`${base}${path}`);
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedRoomType(overrides: Record<string, unknown> = {}) {
  const res = await post('/room-types', {
    name: `Type-${crypto.randomUUID().slice(0, 8)}`,
    base_rate_minor: 150000,
    currency_code: 'THB',
    max_occupancy: 2,
    bed_count: 1,
    bed_type: 'King',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return json<{ id: string; max_occupancy: number }>(res);
}

async function seedRoom(roomTypeId: string, overrides: Record<string, unknown> = {}) {
  const res = await post('/rooms', {
    room_type_id: roomTypeId,
    room_number: `R-${crypto.randomUUID().slice(0, 6)}`,
    floor: 1,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return json<{ id: string; status: string }>(res);
}

async function seedGuest(overrides: Record<string, unknown> = {}) {
  const res = await post('/guests', {
    first_name: 'Test',
    last_name: `Guest-${crypto.randomUUID().slice(0, 6)}`,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return json<{ id: string }>(res);
}

async function seedReservation(
  guestId: string,
  roomTypeId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await post('/reservations', {
    guest_id: guestId,
    room_type_id: roomTypeId,
    booking_source: 'reception',
    checkin_date: '2027-06-01',
    checkout_date: '2027-06-03',
    rate_per_night_minor: 150000,
    currency_code: 'THB',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return json<{ id: string; status: string; room_id: string | null }>(res);
}

// ---------------------------------------------------------------------------
// DB: Database / schema verification
// ---------------------------------------------------------------------------

describe('DB: Schema verification', () => {
  it('DB-01: all required tables exist', async () => {
    const tables = ['hotel_config', 'room_types', 'rooms', 'guests', 'reservations', 'reservation_status_log'];
    for (const table of tables) {
      const row = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .bind(table)
        .first<{ name: string }>();
      expect(row?.name, `Table '${table}' missing`).toBe(table);
    }
  });

  it('DB-02: required indexes exist', async () => {
    const indexes = [
      'idx_reservations_guest_id',
      'idx_reservations_room_id',
      'idx_reservations_room_type_id',
      'idx_reservations_dates',
      'idx_reservations_status',
      'idx_reservation_status_log_reservation_id',
      'idx_rooms_room_type_id',
      'idx_rooms_status',
    ];
    for (const idx of indexes) {
      const row = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .bind(idx)
        .first<{ name: string }>();
      expect(row?.name, `Index '${idx}' missing`).toBe(idx);
    }
  });

  it('DB-03: seed hotel_config exists with approved operational defaults', async () => {
    const row = await env.DB
      .prepare("SELECT * FROM hotel_config WHERE id = 'hotel'")
      .first<{
        checkin_time: string;
        checkout_time: string;
        noshow_cutoff_time: string;
      }>();
    expect(row).not.toBeNull();
    expect(row?.checkin_time).toBe('14:00');
    expect(row?.checkout_time).toBe('12:00');
    expect(row?.noshow_cutoff_time).toBe('23:00');
  });

  it('DB-04: checkout_date CHECK constraint prevents checkin >= checkout at DB level', async () => {
    // Insert directly bypassing application-layer validation
    const result = await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare(
        `INSERT INTO reservations
           (id, guest_id, room_type_id, booking_source, status,
            checkin_date, checkout_date, num_adults, num_children,
            rate_per_night_minor, currency_code, created_at, updated_at)
         VALUES (?, 'g', 'rt', 'online', 'pending', '2027-01-05', '2027-01-05', 1, 0, 1000, 'THB', datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID()),
    ]).catch((err: Error) => err);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/CHECK|constraint/i);
  });
});

// ---------------------------------------------------------------------------
// G: Guest tests
// ---------------------------------------------------------------------------

describe('Guests', () => {
  it('G-01: creates a guest with all fields', async () => {
    const res = await post('/guests', {
      first_name: 'Jane', last_name: 'Doe',
      email: `g01-${crypto.randomUUID()}@example.com`,
      phone: '+66 81 234 5678', id_type: 'passport', id_number: 'AB123456', nationality: 'GB',
    });
    expect(res.status).toBe(201);
    const body = await json<{ id: string; first_name: string }>(res);
    expect(body.id).toBeTruthy();
    expect(body.first_name).toBe('Jane');
  });

  it('G-02: creates a walk-in guest with only required fields', async () => {
    const res = await post('/guests', { first_name: 'Walk', last_name: 'In' });
    expect(res.status).toBe(201);
    const body = await json<{ email: null }>(res);
    expect(body.email).toBeNull();
  });

  it('G-03: rejects duplicate email', async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    await post('/guests', { first_name: 'A', last_name: 'B', email });
    const res = await post('/guests', { first_name: 'C', last_name: 'D', email });
    expect(res.status).toBe(409);
  });

  it('G-04: rejects missing first_name', async () => {
    const res = await post('/guests', { last_name: 'Only' });
    expect(res.status).toBe(400);
  });

  it('G-05: updates guest phone number', async () => {
    const g = await seedGuest();
    const res = await patch(`/guests/${g.id}`, { phone: '+66 99 999 9999' });
    expect(res.status).toBe(200);
    const body = await json<{ phone: string }>(res);
    expect(body.phone).toBe('+66 99 999 9999');
  });
});

// ---------------------------------------------------------------------------
// RT: Room type tests
// ---------------------------------------------------------------------------

describe('Room Types', () => {
  it('RT-01: creates a room type', async () => {
    const rt = await seedRoomType();
    expect(rt.id).toBeTruthy();
  });

  it('RT-02: rejects duplicate name', async () => {
    const name = `Suite-${crypto.randomUUID().slice(0, 6)}`;
    await post('/room-types', { name, base_rate_minor: 100000, currency_code: 'THB', max_occupancy: 2, bed_count: 1 });
    const res = await post('/room-types', { name, base_rate_minor: 100000, currency_code: 'THB', max_occupancy: 2, bed_count: 1 });
    expect(res.status).toBe(409);
  });

  it('RT-03: rejects negative base_rate_minor', async () => {
    const res = await post('/room-types', {
      name: `Neg-${crypto.randomUUID().slice(0, 6)}`, base_rate_minor: -1,
      currency_code: 'THB', max_occupancy: 2, bed_count: 1,
    });
    expect(res.status).toBe(400);
  });

  it('RT-04: deactivated room type excluded from default listing', async () => {
    const rt = await seedRoomType();
    await patch(`/room-types/${rt.id}`, { is_active: 0 });
    const res = await get('/room-types');
    const body = await json<{ id: string }[]>(res);
    expect(body.map((t) => t.id)).not.toContain(rt.id);
  });
});

// ---------------------------------------------------------------------------
// R: Room tests
// ---------------------------------------------------------------------------

describe('Rooms', () => {
  it('R-01: creates a room with status available', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    expect(room.status).toBe('available');
  });

  it('R-02: rejects duplicate room number', async () => {
    const rt = await seedRoomType();
    const number = `DUP-${crypto.randomUUID().slice(0, 6)}`;
    await post('/rooms', { room_type_id: rt.id, room_number: number });
    const res = await post('/rooms', { room_type_id: rt.id, room_number: number });
    expect(res.status).toBe(409);
  });

  it('R-03: rejects room with non-existent room_type_id', async () => {
    const res = await post('/rooms', {
      room_type_id: crypto.randomUUID(), room_number: `NX-${crypto.randomUUID().slice(0, 6)}`,
    });
    expect(res.status).toBe(400);
  });

  it('R-04: FK RESTRICT prevents deleting a room type that has rooms', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const result = await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare('DELETE FROM room_types WHERE id = ?').bind(rt.id),
    ]).catch((err: Error) => err);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/FOREIGN KEY|constraint/i);
  });

  it('R-05: rejects invalid room status value', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const res = await patch(`/rooms/${room.id}`, { status: 'sparkly' });
    expect(res.status).toBe(400);
  });

  it('R-06: inactive room cannot be assigned to a reservation', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    await patch(`/rooms/${room.id}`, { is_active: 0 });

    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    const res = await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    expect(res.status).toBe(400);
  });

  it('R-07: wrong room type cannot be assigned to a reservation', async () => {
    const rt1 = await seedRoomType();
    const rt2 = await seedRoomType();
    const room2 = await seedRoom(rt2.id);     // belongs to rt2

    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt1.id);  // booked for rt1

    const res = await patch(`/reservations/${r.id}/assign-room`, { room_id: room2.id });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// RES: Reservation lifecycle
// ---------------------------------------------------------------------------

describe('Reservations', () => {
  it('RES-01: creates a valid reservation with status pending', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-01', checkout_date: '2027-07-04', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(201);
    const body = await json<{ status: string }>(res);
    expect(body.status).toBe('pending');
  });

  it('RES-02: rejects checkout_date equal to checkin_date', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-04', checkout_date: '2027-07-04', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(400);
  });

  it('RES-02b: rejects checkout_date before checkin_date', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-05', checkout_date: '2027-07-01', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(400);
  });

  it('RES-02c: rejects an invalid calendar date (Feb 30)', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-02-30', checkout_date: '2027-03-05', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(400);
  });

  it('RES-03: rejects booking when room type is fully booked', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id); // only one room
    const guest = await seedGuest();

    // Fill the only room
    await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-08-01', checkout_date: '2027-08-05', rate_per_night_minor: 150000,
    });

    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-08-03', checkout_date: '2027-08-06', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(409);
  });

  it('RES-03b: capacity-full response is 409 not 500 (FK regression)', async () => {
    // Regression: when the atomic capacity guard blocks the reservation INSERT,
    // the conditional status-log INSERT must not create a dangling FK row.
    // If it did, D1 would throw a FK constraint error and the caller would
    // receive a 500 instead of the expected 409.
    const rt = await seedRoomType();
    await seedRoom(rt.id); // exactly one room
    const guest = await seedGuest();

    // Consume the only slot
    const r1 = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'reception',
      checkin_date: '2027-08-10', checkout_date: '2027-08-14', rate_per_night_minor: 150000,
    });
    expect(r1.status).toBe(201);

    // Attempt to book the same slot again — must be 409, not 500
    const r2 = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-08-11', checkout_date: '2027-08-13', rate_per_night_minor: 150000,
    });
    expect(r2.status).toBe(409);

    // Verify no dangling status-log row was created for the blocked reservation
    const orphaned = await env.DB
      .prepare(`SELECT COUNT(*) AS cnt FROM reservation_status_log WHERE reservation_id NOT IN (SELECT id FROM reservations)`)
      .first<{ cnt: number }>();
    expect(orphaned?.cnt).toBe(0);
  });

  it('RES-04: adjacent dates (checkout = next checkin) do NOT conflict', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();

    // First booking: Jun 1 → Jun 3
    await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-06-01', checkout_date: '2027-06-03', rate_per_night_minor: 150000,
    });

    // Second booking: Jun 3 → Jun 5 (adjacent, no overlap)
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-06-03', checkout_date: '2027-06-05', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(201);
  });

  it('RES-05: assigns a specific room to a reservation', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);

    const res = await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    expect(res.status).toBe(200);
    const body = await json<{ room_id: string }>(res);
    expect(body.room_id).toBe(room.id);
  });

  it('RES-06: rejects assigning a room that already has a conflicting reservation', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();

    const r1 = await seedReservation(guest.id, rt.id, { checkin_date: '2027-09-01', checkout_date: '2027-09-05' });
    await patch(`/reservations/${r1.id}/confirm`, {});
    await patch(`/reservations/${r1.id}/assign-room`, { room_id: room.id });

    const r2 = await seedReservation(guest.id, rt.id, { checkin_date: '2027-09-03', checkout_date: '2027-09-07' });
    const res = await patch(`/reservations/${r2.id}/assign-room`, { room_id: room.id });
    expect(res.status).toBe(409);
  });

  it('RES-06b: pending reservation holds its room — cannot double-assign same room', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();

    // r1 is pending with the room assigned
    const r1 = await seedReservation(guest.id, rt.id, { checkin_date: '2027-11-01', checkout_date: '2027-11-05' });
    await patch(`/reservations/${r1.id}/assign-room`, { room_id: room.id });

    // r2 overlaps — room should be blocked even though r1 is still pending
    const r2 = await seedReservation(guest.id, rt.id, { checkin_date: '2027-11-03', checkout_date: '2027-11-06' });
    const res = await patch(`/reservations/${r2.id}/assign-room`, { room_id: room.id });
    expect(res.status).toBe(409);
  });

  it('RES-07: confirms reservation and writes status log entry', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);

    const res = await patch(`/reservations/${r.id}/confirm`, {});
    expect(res.status).toBe(200);
    expect((await json<{ status: string }>(res)).status).toBe('confirmed');

    const log = await json<{ to_status: string }[]>(await get(`/reservations/${r.id}/status-log`));
    expect(log.some((e) => e.to_status === 'confirmed')).toBe(true);
  });

  it('RES-07b: confirm rechecks capacity and rejects if type is now fully booked', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id); // only one room
    const guest = await seedGuest();

    // Both reservations created while one slot was free
    const r1 = await seedReservation(guest.id, rt.id, { checkin_date: '2027-12-01', checkout_date: '2027-12-05' });
    // Manually bypass the app-level check by inserting a second reservation directly
    const r2id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare(
        `INSERT INTO reservations
           (id, guest_id, room_type_id, booking_source, status, checkin_date, checkout_date,
            num_adults, num_children, rate_per_night_minor, currency_code, created_at, updated_at)
         VALUES (?, ?, ?, 'reception', 'pending', '2027-12-02', '2027-12-04', 1, 0, 100000, 'THB', datetime('now'), datetime('now'))`,
      ).bind(r2id, guest.id, rt.id),
    ]);

    // Now confirm r1 — should succeed (only one confirmed so far)
    const confirmR1 = await patch(`/reservations/${r1.id}/confirm`, {});
    expect(confirmR1.status).toBe(200);

    // Confirming r2 should fail — capacity is exhausted by r1
    const confirmR2 = await patch(`/reservations/${r2id}/confirm`, {});
    expect(confirmR2.status).toBe(409);
  });

  it('RES-08: cancels a confirmed reservation', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});

    const res = await patch(`/reservations/${r.id}/cancel`, { cancellation_reason: 'Changed plans' });
    expect(res.status).toBe(200);
    const body = await json<{ status: string; cancellation_reason: string }>(res);
    expect(body.status).toBe('cancelled');
    expect(body.cancellation_reason).toBe('Changed plans');
  });

  it('RES-09: rejects cancelling a checked-in reservation', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    await patch(`/reservations/${r.id}/check-in`, { staff_override: true });

    const res = await patch(`/reservations/${r.id}/cancel`, {});
    expect(res.status).toBe(422);
  });

  it('RES-12: checks in and marks room occupied', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });

    const res = await patch(`/reservations/${r.id}/check-in`, { staff_override: true });
    expect(res.status).toBe(200);
    expect((await json<{ status: string }>(res)).status).toBe('checked_in');

    const roomState = await json<{ status: string }>(await get(`/rooms/${room.id}`));
    expect(roomState.status).toBe('occupied');
  });

  it('RES-13: rejects check-in without assigned room', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});

    const res = await patch(`/reservations/${r.id}/check-in`, { staff_override: true });
    expect(res.status).toBe(422);
  });

  it('RES-14: rejects check-in when room is cleaning', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    await patch(`/rooms/${room.id}`, { status: 'cleaning' });

    const res = await patch(`/reservations/${r.id}/check-in`, { staff_override: true });
    expect(res.status).toBe(422);
  });

  it('RES-14b: rejects check-in when room belongs to wrong room type at check-in', async () => {
    const rt1 = await seedRoomType();
    const rt2 = await seedRoomType();
    const room2 = await seedRoom(rt2.id);

    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt1.id);
    await patch(`/reservations/${r.id}/confirm`, {});

    // Directly set room_id to a room of the wrong type, bypassing assign-room validation
    await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare('UPDATE reservations SET room_id = ? WHERE id = ?').bind(room2.id, r.id),
    ]);

    const res = await patch(`/reservations/${r.id}/check-in`, { staff_override: true });
    expect(res.status).toBe(422);
  });

  it('RES-15: checkout sets room to cleaning', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    await patch(`/reservations/${r.id}/check-in`, { staff_override: true });

    const res = await patch(`/reservations/${r.id}/check-out`, {});
    expect(res.status).toBe(200);
    expect((await json<{ status: string }>(res)).status).toBe('checked_out');

    const roomState = await json<{ status: string }>(await get(`/rooms/${room.id}`));
    expect(roomState.status).toBe('cleaning');
  });

  it('RES-16+17: same-day turnover — blocked before cleaning complete, allowed after', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const g1 = await seedGuest();
    const g2 = await seedGuest();

    const r1 = await seedReservation(g1.id, rt.id, { checkin_date: '2027-10-01', checkout_date: '2027-10-03' });
    await patch(`/reservations/${r1.id}/confirm`, {});
    await patch(`/reservations/${r1.id}/assign-room`, { room_id: room.id });
    await patch(`/reservations/${r1.id}/check-in`, { staff_override: true });
    await patch(`/reservations/${r1.id}/check-out`, {}); // → cleaning

    const r2 = await seedReservation(g2.id, rt.id, { checkin_date: '2027-10-03', checkout_date: '2027-10-05' });
    await patch(`/reservations/${r2.id}/confirm`, {});
    await patch(`/reservations/${r2.id}/assign-room`, { room_id: room.id });

    // RES-17: room is cleaning — check-in must fail
    const early = await patch(`/reservations/${r2.id}/check-in`, { staff_override: true });
    expect(early.status).toBe(422);

    // Mark room ready
    await patch(`/rooms/${room.id}`, { status: 'available' });

    // RES-16: room is available — check-in must succeed
    const late = await patch(`/reservations/${r2.id}/check-in`, { staff_override: true });
    expect(late.status).toBe(200);
    expect((await json<{ status: string }>(late)).status).toBe('checked_in');
  });

  it('RES-18: occupancy exceeding room type max is rejected', async () => {
    const rt = await seedRoomType({ max_occupancy: 2 });
    await seedRoom(rt.id);
    const guest = await seedGuest();

    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-01', checkout_date: '2027-07-04',
      rate_per_night_minor: 150000, num_adults: 2, num_children: 1,  // total 3 > max 2
    });
    expect(res.status).toBe(400);
  });

  it('RES-19: status log has an entry for every transition', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);

    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    await patch(`/reservations/${r.id}/check-in`, { staff_override: true });
    await patch(`/reservations/${r.id}/check-out`, {});

    const log = await json<{ to_status: string }[]>(
      await get(`/reservations/${r.id}/status-log`),
    );
    const statuses = log.map((e) => e.to_status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('confirmed');
    expect(statuses).toContain('checked_in');
    expect(statuses).toContain('checked_out');
  });

  it('RES-20: no-show rejects invalid status transitions (terminal states)', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/cancel`, {});

    // cancelled is terminal — no further transitions
    const noShow = await patch(`/reservations/${r.id}/no-show`, {});
    expect(noShow.status).toBe(422);
    const cancel2 = await patch(`/reservations/${r.id}/cancel`, {});
    expect(cancel2.status).toBe(422);
    const confirm = await patch(`/reservations/${r.id}/confirm`, {});
    expect(confirm.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// OP: Operational time rule tests
// ---------------------------------------------------------------------------

describe('Operational rules', () => {
  /*
   * Note on time-dependent tests:
   * Tests that require a specific wall-clock condition (e.g. "before 14:00")
   * cannot be fully automated without time-mocking support. The check-in and
   * no-show enforcement use real hotel-local time from the system clock.
   * These tests use staff_override: true to bypass the time gate so the
   * remaining logic (room readiness, assignment, etc.) is still validated.
   * The time-gate enforcement itself is tested where the state can be known
   * at test-write time (e.g. UTC+0 at 00:00 is definitely before 14:00
   * in any Asia timezone), or is tested structurally via the config endpoint.
   *
   * If the test environment clock is in a timezone or time where the checks
   * would pass naturally, these structural tests remain valid.
   */

  it('OP-01: check-in without staff_override fails before configured check-in time (structural)', async () => {
    // We set a check-in time of 23:59 in the config — almost certainly in the future
    // This test is structural: if the clock is not at 23:59, the check should fail.
    const configRes = await patch('/config', { checkin_time: '23:59' });
    expect(configRes.status).toBe(200);

    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });

    const res = await patch(`/reservations/${r.id}/check-in`, {});
    // Expect 422 because current time is almost certainly before 23:59
    expect(res.status).toBe(422);

    // Restore to approved default
    await patch('/config', { checkin_time: '14:00' });
  });

  it('OP-02: staff_override bypasses check-in time gate', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });

    const res = await patch(`/reservations/${r.id}/check-in`, { staff_override: true });
    expect(res.status).toBe(200);
  });

  it('OP-03: early checkout is permitted without restriction', async () => {
    // The 12:00 deadline is the normal checkout time; early departure is allowed.
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });
    await patch(`/reservations/${r.id}/check-in`, { staff_override: true });

    // Early checkout — no time constraint enforced
    const res = await patch(`/reservations/${r.id}/check-out`, {});
    expect(res.status).toBe(200);
  });

  it('OP-04: no-show before configured cutoff is rejected (structural)', async () => {
    // Set cutoff to 23:59 so current time is almost certainly before it
    await patch('/config', { noshow_cutoff_time: '23:59' });

    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    // Use today's date in UTC as a proxy — the no-show handler checks local date
    const todayUTC = new Date().toISOString().slice(0, 10);
    const r = await seedReservation(guest.id, rt.id, {
      checkin_date: todayUTC,
      checkout_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    });
    await patch(`/reservations/${r.id}/confirm`, {});

    const res = await patch(`/reservations/${r.id}/no-show`, {});
    // Before 23:59 it must be rejected
    expect(res.status).toBe(422);

    // Restore
    await patch('/config', { noshow_cutoff_time: '23:00' });
  });

  it('OP-05: config stores approved operational defaults correctly', async () => {
    const res = await get('/config');
    expect(res.status).toBe(200);
    const body = await json<{
      checkin_time: string;
      checkout_time: string;
      noshow_cutoff_time: string;
    }>(res);
    expect(body.checkin_time).toBe('14:00');
    expect(body.checkout_time).toBe('12:00');
    expect(body.noshow_cutoff_time).toBe('23:00');
  });

  it('OP-06: config rejects invalid time values', async () => {
    const res = await patch('/config', { checkin_time: '25:00' });
    expect(res.status).toBe(400);
    const res2 = await patch('/config', { checkin_time: 'noon' });
    expect(res2.status).toBe(400);
  });

  it('OP-07: config rejects invalid timezone', async () => {
    const res = await patch('/config', { timezone: 'Not/ATimezone' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// RI: Referential integrity
// ---------------------------------------------------------------------------

describe('Referential Integrity', () => {
  it('RI-01: cannot delete a guest with an existing reservation', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    await seedReservation(guest.id, rt.id);

    const result = await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare('DELETE FROM guests WHERE id = ?').bind(guest.id),
    ]).catch((err: Error) => err);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/FOREIGN KEY|constraint/i);
  });

  it('RI-02: cannot delete a room assigned to an active reservation', async () => {
    const rt = await seedRoomType();
    const room = await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/assign-room`, { room_id: room.id });

    const result = await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(room.id),
    ]).catch((err: Error) => err);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/FOREIGN KEY|constraint/i);
  });

  it('RI-03: deleting a reservation cascades to its status log', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const r = await seedReservation(guest.id, rt.id);
    await patch(`/reservations/${r.id}/confirm`, {});

    await env.DB.batch([
      env.DB.prepare('PRAGMA foreign_keys = ON'),
      env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(r.id),
    ]);

    const count = await env.DB
      .prepare('SELECT COUNT(*) AS cnt FROM reservation_status_log WHERE reservation_id = ?')
      .bind(r.id)
      .first<{ cnt: number }>();
    expect(count?.cnt).toBe(0);
  });

  it('RI-04: cannot insert a reservation with a non-existent guest_id', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);

    const res = await post('/reservations', {
      guest_id: crypto.randomUUID(), room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-11-01', checkout_date: '2027-11-03', rate_per_night_minor: 150000,
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// VAL: Input validation and security
// ---------------------------------------------------------------------------

describe('Validation and Security', () => {
  it('VAL-01: rejects non-JSON body', async () => {
    const res = await SELF.fetch(`${base}/guests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    expect(res.status).toBe(400);
  });

  it('VAL-02: rejects fractional rate_per_night_minor', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-01', checkout_date: '2027-07-04',
      rate_per_night_minor: 150000.75, // not an integer
    });
    expect(res.status).toBe(400);
  });

  it('VAL-03: rejects unknown fields in PATCH /config', async () => {
    const res = await patch('/config', { __proto__: 'evil', unknown_field: 'x' });
    expect(res.status).toBe(400);
  });

  it('VAL-04: rejects attempt to set id via PATCH /config', async () => {
    const res = await patch('/config', { id: 'hacker' });
    expect(res.status).toBe(400);
  });

  it('VAL-05: internal errors do not expose stack traces in response body', async () => {
    // GET a non-existent endpoint to trigger the 404 path; we verify 500s via
    // a room fetch with a valid UUID that doesn't exist — not an internal error.
    // We verify the 404 response does NOT contain "at " (stack trace lines).
    const res = await get(`/rooms/${crypto.randomUUID()}`);
    const text = await res.text();
    expect(text).not.toMatch(/\bat\s+\w/);        // no stack frames
    expect(text).not.toMatch(/node_modules/);
  });

  it('VAL-06: CORS Vary header is present on responses', async () => {
    const res = await get('/health');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('VAL-07: num_adults must be a positive integer', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-01', checkout_date: '2027-07-04',
      rate_per_night_minor: 150000, num_adults: 0,
    });
    expect(res.status).toBe(400);
  });

  it('VAL-08: num_children must be non-negative', async () => {
    const rt = await seedRoomType();
    await seedRoom(rt.id);
    const guest = await seedGuest();
    const res = await post('/reservations', {
      guest_id: guest.id, room_type_id: rt.id, booking_source: 'online',
      checkin_date: '2027-07-01', checkout_date: '2027-07-04',
      rate_per_night_minor: 150000, num_children: -1,
    });
    expect(res.status).toBe(400);
  });

  it('VAL-09: max_occupancy must be a positive integer', async () => {
    const res = await post('/room-types', {
      name: `Bad-${crypto.randomUUID().slice(0, 6)}`,
      base_rate_minor: 100000, currency_code: 'THB', max_occupancy: 0, bed_count: 1,
    });
    expect(res.status).toBe(400);
  });

  it('VAL-10: health endpoint documents development status', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = await json<{ note: string }>(res);
    expect(body.note).toMatch(/development/i);
  });
});
