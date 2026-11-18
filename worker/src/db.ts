/**
 * Hotel Management System — Database helper layer.
 * (c)SIDGAKS Tech
 *
 * All D1 interactions go through this module.
 *
 * Key invariants enforced here:
 *  - PRAGMA foreign_keys = ON is prepended to every write batch.
 *  - Update helpers use explicit field allowlists to prevent SQL injection
 *    via user-supplied property names.
 *  - Availability checks for specific rooms include 'pending' status so a
 *    room allocated to a pending reservation is not silently double-allocated.
 *  - The atomic createReservation path wraps the inventory check and INSERT
 *    in a single D1 batch to prevent concurrent overbooking.
 */

import type {
  HotelConfig,
  RoomType,
  Room,
  RoomStatus,
  Guest,
  Reservation,
  ReservationStatus,
  ReservationStatusLog,
} from './types';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Returns a new UUID v4 string using the Web Crypto API available in Workers. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Returns the current UTC timestamp as an ISO 8601 string. */
export function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Returns the current wall-clock time in the hotel's local timezone as an
 * "HH:MM" string (24-hour). Used for check-in, check-out and no-show rules.
 */
export function localTimeHHMM(timezone: string): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Returns today's date in the hotel's local timezone as a "YYYY-MM-DD" string.
 */
export function localDateYMD(timezone: string): string {
  // en-CA locale produces "YYYY-MM-DD" format natively.
  const raw = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  return raw.trim();
}

/**
 * Prepends PRAGMA foreign_keys = ON to any DML batch.
 * Required because D1/SQLite disables FK enforcement by default.
 */
async function batchWithFk(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  return db.batch([db.prepare('PRAGMA foreign_keys = ON'), ...statements]);
}

// ---------------------------------------------------------------------------
// hotel_config
// ---------------------------------------------------------------------------

/**
 * Allowed fields that callers may update on hotel_config.
 * Primary key, system-managed timestamps, and sentinel id are excluded.
 */
const HOTEL_CONFIG_UPDATABLE: ReadonlySet<string> = new Set([
  'hotel_name',
  'address_line1',
  'address_line2',
  'city',
  'country',
  'postal_code',
  'phone',
  'email',
  'currency_code',
  'timezone',
  'checkin_time',
  'checkout_time',
  'noshow_cutoff_time',
  'default_cancellation_hours',
]);

export async function getHotelConfig(db: D1Database): Promise<HotelConfig | null> {
  const row = await db
    .prepare("SELECT * FROM hotel_config WHERE id = 'hotel'")
    .first<HotelConfig>();
  return row ?? null;
}

export async function updateHotelConfig(
  db: D1Database,
  patch: Partial<Omit<HotelConfig, 'id' | 'created_at' | 'updated_at'>>,
): Promise<HotelConfig | null> {
  // Filter to only allowlisted fields
  const fields = Object.keys(patch).filter((f) => HOTEL_CONFIG_UPDATABLE.has(f));
  if (fields.length === 0) return getHotelConfig(db);

  const set = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as Record<string, unknown>)[f]);
  const now = utcNow();

  await batchWithFk(db, [
    db.prepare(`UPDATE hotel_config SET ${set}, updated_at = ? WHERE id = 'hotel'`)
      .bind(...values, now),
  ]);
  return getHotelConfig(db);
}

// ---------------------------------------------------------------------------
// room_types
// ---------------------------------------------------------------------------

/** Allowed update fields for room_types. */
const ROOM_TYPE_UPDATABLE: ReadonlySet<string> = new Set([
  'name',
  'description',
  'base_rate_minor',
  'currency_code',
  'max_occupancy',
  'bed_count',
  'bed_type',
  'is_active',
]);

export async function listRoomTypes(db: D1Database, activeOnly = true): Promise<RoomType[]> {
  const sql = activeOnly
    ? 'SELECT * FROM room_types WHERE is_active = 1 ORDER BY name'
    : 'SELECT * FROM room_types ORDER BY name';
  const result = await db.prepare(sql).all<RoomType>();
  return result.results;
}

export async function getRoomType(db: D1Database, id: string): Promise<RoomType | null> {
  const row = await db
    .prepare('SELECT * FROM room_types WHERE id = ?')
    .bind(id)
    .first<RoomType>();
  return row ?? null;
}

export async function createRoomType(
  db: D1Database,
  data: Omit<RoomType, 'id' | 'is_active' | 'created_at' | 'updated_at'>,
): Promise<RoomType> {
  const id = newId();
  const now = utcNow();
  await batchWithFk(db, [
    db.prepare(
      `INSERT INTO room_types
         (id, name, description, base_rate_minor, currency_code,
          max_occupancy, bed_count, bed_type, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      id, data.name, data.description ?? null, data.base_rate_minor, data.currency_code,
      data.max_occupancy, data.bed_count, data.bed_type ?? null, now, now,
    ),
  ]);
  return (await getRoomType(db, id))!;
}

export async function updateRoomType(
  db: D1Database,
  id: string,
  patch: Partial<Omit<RoomType, 'id' | 'created_at' | 'updated_at'>>,
): Promise<RoomType | null> {
  const fields = Object.keys(patch).filter((f) => ROOM_TYPE_UPDATABLE.has(f));
  if (fields.length === 0) return getRoomType(db, id);

  const set = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as Record<string, unknown>)[f]);
  const now = utcNow();

  await batchWithFk(db, [
    db.prepare(`UPDATE room_types SET ${set}, updated_at = ? WHERE id = ?`)
      .bind(...values, now, id),
  ]);
  return getRoomType(db, id);
}

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------

/** Allowed update fields for rooms. */
const ROOM_UPDATABLE: ReadonlySet<string> = new Set([
  'room_type_id',
  'room_number',
  'floor',
  'status',
  'description',
  'is_active',
]);

export async function listRooms(
  db: D1Database,
  opts: { roomTypeId?: string; status?: RoomStatus; activeOnly?: boolean } = {},
): Promise<Room[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (opts.activeOnly !== false) {
    conditions.push('is_active = 1');
  }
  if (opts.roomTypeId) {
    conditions.push('room_type_id = ?');
    bindings.push(opts.roomTypeId);
  }
  if (opts.status) {
    conditions.push('status = ?');
    bindings.push(opts.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM rooms ${where} ORDER BY room_number`)
    .bind(...bindings)
    .all<Room>();
  return result.results;
}

export async function getRoom(db: D1Database, id: string): Promise<Room | null> {
  const row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first<Room>();
  return row ?? null;
}

export async function createRoom(
  db: D1Database,
  data: Omit<Room, 'id' | 'status' | 'is_active' | 'created_at' | 'updated_at'>,
): Promise<Room> {
  const id = newId();
  const now = utcNow();
  await batchWithFk(db, [
    db.prepare(
      `INSERT INTO rooms
         (id, room_type_id, room_number, floor, status, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'available', ?, 1, ?, ?)`,
    ).bind(
      id, data.room_type_id, data.room_number, data.floor ?? null,
      data.description ?? null, now, now,
    ),
  ]);
  return (await getRoom(db, id))!;
}

export async function updateRoom(
  db: D1Database,
  id: string,
  patch: Partial<Omit<Room, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Room | null> {
  const fields = Object.keys(patch).filter((f) => ROOM_UPDATABLE.has(f));
  if (fields.length === 0) return getRoom(db, id);

  const set = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as Record<string, unknown>)[f]);
  const now = utcNow();

  await batchWithFk(db, [
    db.prepare(`UPDATE rooms SET ${set}, updated_at = ? WHERE id = ?`)
      .bind(...values, now, id),
  ]);
  return getRoom(db, id);
}

// ---------------------------------------------------------------------------
// guests
// ---------------------------------------------------------------------------

/** Allowed update fields for guests. */
const GUEST_UPDATABLE: ReadonlySet<string> = new Set([
  'first_name',
  'last_name',
  'email',
  'phone',
  'id_type',
  'id_number',
  'nationality',
  'address_line1',
  'address_line2',
  'city',
  'country',
  'postal_code',
  'notes',
]);

export async function listGuests(db: D1Database): Promise<Guest[]> {
  const result = await db
    .prepare('SELECT * FROM guests ORDER BY last_name, first_name')
    .all<Guest>();
  return result.results;
}

export async function getGuest(db: D1Database, id: string): Promise<Guest | null> {
  const row = await db.prepare('SELECT * FROM guests WHERE id = ?').bind(id).first<Guest>();
  return row ?? null;
}

export async function getGuestByEmail(db: D1Database, email: string): Promise<Guest | null> {
  const row = await db
    .prepare('SELECT * FROM guests WHERE email = ?')
    .bind(email)
    .first<Guest>();
  return row ?? null;
}

export async function searchGuests(db: D1Database, query: string): Promise<Guest[]> {
  const like = `%${query}%`;
  const result = await db
    .prepare(
      `SELECT * FROM guests
       WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
       ORDER BY last_name, first_name
       LIMIT 50`,
    )
    .bind(like, like, like)
    .all<Guest>();
  return result.results;
}

export async function createGuest(
  db: D1Database,
  data: Omit<Guest, 'id' | 'created_at' | 'updated_at'>,
): Promise<Guest> {
  const id = newId();
  const now = utcNow();
  await batchWithFk(db, [
    db.prepare(
      `INSERT INTO guests
         (id, first_name, last_name, email, phone, id_type, id_number,
          nationality, address_line1, address_line2, city, country, postal_code, notes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, data.first_name, data.last_name, data.email ?? null, data.phone ?? null,
      data.id_type ?? null, data.id_number ?? null, data.nationality ?? null,
      data.address_line1 ?? null, data.address_line2 ?? null, data.city ?? null,
      data.country ?? null, data.postal_code ?? null, data.notes ?? null, now, now,
    ),
  ]);
  return (await getGuest(db, id))!;
}

export async function updateGuest(
  db: D1Database,
  id: string,
  patch: Partial<Omit<Guest, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Guest | null> {
  const fields = Object.keys(patch).filter((f) => GUEST_UPDATABLE.has(f));
  if (fields.length === 0) return getGuest(db, id);

  const set = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as Record<string, unknown>)[f]);
  const now = utcNow();

  await batchWithFk(db, [
    db.prepare(`UPDATE guests SET ${set}, updated_at = ? WHERE id = ?`)
      .bind(...values, now, id),
  ]);
  return getGuest(db, id);
}

// ---------------------------------------------------------------------------
// reservations
// ---------------------------------------------------------------------------

export async function getReservation(db: D1Database, id: string): Promise<Reservation | null> {
  const row = await db
    .prepare('SELECT * FROM reservations WHERE id = ?')
    .bind(id)
    .first<Reservation>();
  return row ?? null;
}

export async function listReservations(
  db: D1Database,
  opts: { guestId?: string; status?: ReservationStatus; date?: string } = {},
): Promise<Reservation[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (opts.guestId) {
    conditions.push('guest_id = ?');
    bindings.push(opts.guestId);
  }
  if (opts.status) {
    conditions.push('status = ?');
    bindings.push(opts.status);
  }
  if (opts.date) {
    conditions.push('checkin_date <= ? AND checkout_date > ?');
    bindings.push(opts.date, opts.date);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM reservations ${where} ORDER BY checkin_date DESC`)
    .bind(...bindings)
    .all<Reservation>();
  return result.results;
}

/**
 * Returns the count of active reservations (pending | confirmed | checked_in)
 * for a given room type that overlap [checkinDate, checkoutDate).
 *
 * Uses half-open interval: checkin_date < requested.checkout AND
 * checkout_date > requested.checkin. Adjacent dates (checkout = next checkin)
 * do NOT overlap — matching the approved same-day turnover rule.
 */
export async function countOverlappingReservationsByType(
  db: D1Database,
  roomTypeId: string,
  checkinDate: string,
  checkoutDate: string,
  excludeReservationId?: string,
): Promise<number> {
  const exclude = excludeReservationId ? 'AND id != ?' : '';
  const bindings: unknown[] = [roomTypeId, checkoutDate, checkinDate];
  if (excludeReservationId) bindings.push(excludeReservationId);

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM reservations
       WHERE room_type_id = ?
         AND status IN ('pending', 'confirmed', 'checked_in')
         AND checkin_date  < ?
         AND checkout_date > ?
         ${exclude}`,
    )
    .bind(...bindings)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Returns the count of active rooms (is_active = 1) for a given room type.
 */
export async function countActiveRoomsByType(
  db: D1Database,
  roomTypeId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM rooms WHERE room_type_id = ? AND is_active = 1`)
    .bind(roomTypeId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Checks whether a specific room has overlapping active reservations.
 *
 * Includes 'pending' status so a room allocated to a pending reservation
 * cannot be silently double-allocated to another overlapping booking.
 * Excludes a given reservation ID when checking for the same reservation.
 */
export async function hasRoomConflict(
  db: D1Database,
  roomId: string,
  checkinDate: string,
  checkoutDate: string,
  excludeReservationId?: string,
): Promise<boolean> {
  const exclude = excludeReservationId ? 'AND id != ?' : '';
  const bindings: unknown[] = [roomId, checkoutDate, checkinDate];
  if (excludeReservationId) bindings.push(excludeReservationId);

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM reservations
       WHERE room_id = ?
         AND status IN ('pending', 'confirmed', 'checked_in')
         AND checkin_date  < ?
         AND checkout_date > ?
         ${exclude}`,
    )
    .bind(...bindings)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) > 0;
}

/**
 * Creates a new reservation.
 *
 * The availability check (countOverlappingReservationsByType) and the INSERT
 * are issued as a single D1 batch so they execute within the same serialisable
 * transaction, preventing a race between two concurrent booking requests that
 * both pass a preliminary availability check outside the batch.
 *
 * The batch is intentionally structured so the INSERT fails at the DB level
 * if the type-level capacity is exhausted, using a subquery-guarded INSERT
 * rather than a two-step check-then-insert.
 *
 * D1 serialises writes within a single transaction; the batch approach is the
 * closest available mechanism to an atomic check-and-insert on D1/SQLite.
 */
export async function createReservation(
  db: D1Database,
  data: Omit<
    Reservation,
    | 'id'
    | 'status'
    | 'confirmed_at'
    | 'cancelled_at'
    | 'cancellation_reason'
    | 'noshow_at'
    | 'checked_in_at'
    | 'checked_out_at'
    | 'created_at'
    | 'updated_at'
  >,
  /** Total active rooms of this type — used for the capacity guard. */
  totalRoomsOfType: number,
): Promise<Reservation> {
  const id = newId();
  const logId = newId();
  const now = utcNow();

  /*
   * Atomic capacity guard:
   * INSERT only if the current overlap count is less than the room capacity.
   * This WHERE clause makes the INSERT a no-op if capacity is already full,
   * which the caller detects by querying the reservation afterwards.
   */
  await batchWithFk(db, [
    /*
     * Statement 1: Capacity-guarded reservation INSERT.
     * The WHERE clause makes this a no-op when the type is fully booked.
     * No row is created; statement 2 (which depends on this id) also
     * produces no row, so no FK violation occurs.
     */
    db.prepare(
      `INSERT INTO reservations (
         id, guest_id, room_type_id, room_id, booking_source, status,
         checkin_date, checkout_date, num_adults, num_children,
         rate_per_night_minor, currency_code, special_requests, created_by,
         confirmed_at, cancelled_at, cancellation_reason, noshow_at,
         checked_in_at, checked_out_at, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, 'pending',
              ?, ?, ?, ?,
              ?, ?, ?, ?,
              NULL, NULL, NULL, NULL,
              NULL, NULL, ?, ?
       WHERE (
         SELECT COUNT(*) FROM reservations
          WHERE room_type_id = ?
            AND status IN ('pending', 'confirmed', 'checked_in')
            AND checkin_date  < ?
            AND checkout_date > ?
       ) < ?`,
    ).bind(
      id, data.guest_id, data.room_type_id, data.room_id ?? null,
      data.booking_source, data.checkin_date, data.checkout_date,
      data.num_adults, data.num_children,
      data.rate_per_night_minor, data.currency_code,
      data.special_requests ?? null, data.created_by ?? null,
      now, now,
      data.room_type_id, data.checkout_date, data.checkin_date, totalRoomsOfType,
    ),
    /*
     * Statement 2: Status log INSERT — only runs if the reservation row exists.
     * Using INSERT … SELECT … WHERE EXISTS prevents a dangling FK violation
     * when statement 1 was blocked by the capacity guard.
     */
    db.prepare(
      `INSERT INTO reservation_status_log
         (id, reservation_id, from_status, to_status, changed_by, reason, changed_at)
       SELECT ?, ?, NULL, 'pending', ?, 'Reservation created', ?
       WHERE EXISTS (SELECT 1 FROM reservations WHERE id = ?)`,
    ).bind(logId, id, data.created_by ?? null, now, id),
  ]);

  const created = await getReservation(db, id);
  if (!created) {
    // The WHERE guard prevented the INSERT — capacity was full at commit time.
    throw new CapacityExceededError('No rooms of this type are available for the requested dates');
  }
  return created;
}

/** Thrown by createReservation when the atomic capacity guard rejects the insert. */
export class CapacityExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapacityExceededError';
  }
}

/**
 * Transitions a reservation to a new status atomically.
 * Does NOT validate the transition — callers must check ALLOWED_TRANSITIONS first.
 * Updates relevant timestamp fields and writes a status log entry in one batch.
 */
export async function transitionReservation(
  db: D1Database,
  id: string,
  toStatus: ReservationStatus,
  opts: {
    changedBy?: string;
    reason?: string;
    roomId?: string;
    cancellationReason?: string;
  } = {},
): Promise<Reservation> {
  const now = utcNow();
  const logId = newId();

  const current = await getReservation(db, id);
  if (!current) throw new Error(`Reservation ${id} not found`);

  const extraFields: string[] = [];
  const extraValues: unknown[] = [];

  if (toStatus === 'confirmed') {
    extraFields.push('confirmed_at = ?');
    extraValues.push(now);
  } else if (toStatus === 'cancelled') {
    extraFields.push('cancelled_at = ?');
    extraValues.push(now);
    if (opts.cancellationReason) {
      extraFields.push('cancellation_reason = ?');
      extraValues.push(opts.cancellationReason);
    }
  } else if (toStatus === 'no_show') {
    extraFields.push('noshow_at = ?');
    extraValues.push(now);
  } else if (toStatus === 'checked_in') {
    extraFields.push('checked_in_at = ?');
    extraValues.push(now);
    if (opts.roomId) {
      extraFields.push('room_id = ?');
      extraValues.push(opts.roomId);
    }
  } else if (toStatus === 'checked_out') {
    extraFields.push('checked_out_at = ?');
    extraValues.push(now);
  }

  const setClause = ['status = ?', ...extraFields, 'updated_at = ?'].join(', ');

  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE reservations SET ${setClause} WHERE id = ?`)
      .bind(toStatus, ...extraValues, now, id),
    db.prepare(
      `INSERT INTO reservation_status_log
         (id, reservation_id, from_status, to_status, changed_by, reason, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(logId, id, current.status, toStatus, opts.changedBy ?? null, opts.reason ?? null, now),
  ];

  // Check-in: mark room occupied
  if (toStatus === 'checked_in') {
    const roomId = opts.roomId ?? current.room_id;
    if (roomId) {
      stmts.push(
        db.prepare(`UPDATE rooms SET status = 'occupied', updated_at = ? WHERE id = ?`)
          .bind(now, roomId),
      );
    }
  }

  // Check-out: room must enter cleaning — it is NOT available until cleaned and marked ready
  if (toStatus === 'checked_out' && current.room_id) {
    stmts.push(
      db.prepare(`UPDATE rooms SET status = 'cleaning', updated_at = ? WHERE id = ?`)
        .bind(now, current.room_id),
    );
  }

  await batchWithFk(db, stmts);
  return (await getReservation(db, id))!;
}

export async function assignRoomToReservation(
  db: D1Database,
  reservationId: string,
  roomId: string,
): Promise<Reservation | null> {
  const now = utcNow();
  await batchWithFk(db, [
    db.prepare(`UPDATE reservations SET room_id = ?, updated_at = ? WHERE id = ?`)
      .bind(roomId, now, reservationId),
  ]);
  return getReservation(db, reservationId);
}

// ---------------------------------------------------------------------------
// reservation_status_log
// ---------------------------------------------------------------------------

export async function getStatusLog(
  db: D1Database,
  reservationId: string,
): Promise<ReservationStatusLog[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reservation_status_log
       WHERE reservation_id = ?
       ORDER BY changed_at ASC`,
    )
    .bind(reservationId)
    .all<ReservationStatusLog>();
  return result.results;
}
