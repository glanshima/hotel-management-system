/**
 * Routes: Rooms
 *
 * GET    /rooms                    — List rooms (filter: ?roomTypeId=, ?status=, ?all=true)
 * POST   /rooms                    — Create a new room.
 * GET    /rooms/:id                — Get a specific room.
 * PATCH  /rooms/:id                — Update a room (status, description, deactivation).
 * GET    /rooms/availability?roomTypeId=&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
 *                                  — Check type-level availability.
 */

import { json, notFound, badRequest, conflict, parseBody } from '../router';
import {
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  getRoomType,
  countOverlappingReservationsByType,
  countActiveRoomsByType,
} from '../db';
import type { Env, Room, RoomStatus } from '../types';

const VALID_STATUSES: RoomStatus[] = [
  'available', 'occupied', 'cleaning', 'maintenance', 'out_of_order',
];

type Handler = (req: Request, params: Record<string, string>, env: Env) => Promise<Response>;

export const listRoomsHandler: Handler = async (req, _params, env) => {
  const url = new URL(req.url);
  const roomTypeId = url.searchParams.get('roomTypeId') ?? undefined;
  const status = url.searchParams.get('status') as RoomStatus | undefined;
  const all = url.searchParams.get('all') === 'true';

  if (status && !VALID_STATUSES.includes(status)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const rooms = await listRooms(env.DB, { roomTypeId, status, activeOnly: !all });
  return json(rooms);
};

export const checkAvailabilityHandler: Handler = async (req, _params, env) => {
  const url = new URL(req.url);
  const roomTypeId = url.searchParams.get('roomTypeId');
  const checkin = url.searchParams.get('checkin');
  const checkout = url.searchParams.get('checkout');

  if (!roomTypeId) return badRequest('roomTypeId is required');
  if (!checkin || !checkout) return badRequest('checkin and checkout dates are required');
  if (checkout <= checkin) return badRequest('checkout must be after checkin');

  const [totalRooms, overlapping] = await Promise.all([
    countActiveRoomsByType(env.DB, roomTypeId),
    countOverlappingReservationsByType(env.DB, roomTypeId, checkin, checkout),
  ]);

  const availableCount = Math.max(0, totalRooms - overlapping);

  return json({
    room_type_id: roomTypeId,
    checkin_date: checkin,
    checkout_date: checkout,
    total_rooms: totalRooms,
    reserved_rooms: overlapping,
    available_rooms: availableCount,
    is_available: availableCount > 0,
  });
};

export const createRoomHandler: Handler = async (req, _params, env) => {
  type Body = {
    room_type_id: string;
    room_number: string;
    floor?: number;
    description?: string;
  };

  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');
  if (!body.room_type_id?.trim()) return badRequest('room_type_id is required');
  if (!body.room_number?.trim()) return badRequest('room_number is required');

  const roomType = await getRoomType(env.DB, body.room_type_id);
  if (!roomType) return badRequest('room_type_id does not exist');

  try {
    const room = await createRoom(env.DB, {
      room_type_id: body.room_type_id.trim(),
      room_number: body.room_number.trim(),
      floor: typeof body.floor === 'number' ? body.floor : null,
      description: body.description?.trim() ?? null,
    });
    return json(room, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return conflict(`Room number '${body.room_number}' already exists`);
    if (msg.includes('FOREIGN KEY')) return badRequest('room_type_id does not exist');
    throw err;
  }
};

export const getRoomHandler: Handler = async (_req, params, env) => {
  const room = await getRoom(env.DB, params['id']!);
  if (!room) return notFound('Room');
  return json(room);
};

export const updateRoomHandler: Handler = async (req, params, env) => {
  type Body = Partial<Omit<Room, 'id' | 'created_at' | 'updated_at'>>;
  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');

  if ('status' in body && !VALID_STATUSES.includes(body.status!)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if ('is_active' in body && body.is_active !== 0 && body.is_active !== 1) {
    return badRequest('is_active must be 0 or 1');
  }

  try {
    const updated = await updateRoom(env.DB, params['id']!, body);
    if (!updated) return notFound('Room');
    return json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return conflict(`Room number already exists`);
    throw err;
  }
};
