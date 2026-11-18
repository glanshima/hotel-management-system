/**
 * Routes: Room types
 *
 * GET    /room-types           — List all active room types.
 * GET    /room-types?all=true  — List all room types including inactive.
 * POST   /room-types           — Create a new room type.
 * GET    /room-types/:id       — Get a specific room type.
 * PATCH  /room-types/:id       — Update a room type (including deactivation).
 */

import { json, notFound, badRequest, conflict, parseBody } from '../router';
import { listRoomTypes, getRoomType, createRoomType, updateRoomType } from '../db';
import type { Env, RoomType } from '../types';

type Handler = (req: Request, params: Record<string, string>, env: Env) => Promise<Response>;

export const listRoomTypesHandler: Handler = async (req, _params, env) => {
  const url = new URL(req.url);
  const all = url.searchParams.get('all') === 'true';
  const types = await listRoomTypes(env.DB, !all);
  return json(types);
};

export const createRoomTypeHandler: Handler = async (req, _params, env) => {
  type Body = {
    name: string;
    description?: string;
    base_rate_minor: number;
    currency_code: string;
    max_occupancy: number;
    bed_count: number;
    bed_type?: string;
  };

  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');

  if (!body.name?.trim()) return badRequest('name is required');
  if (typeof body.base_rate_minor !== 'number' || body.base_rate_minor < 0)
    return badRequest('base_rate_minor must be a non-negative integer');
  if (!body.currency_code?.trim()) return badRequest('currency_code is required');
  if (typeof body.max_occupancy !== 'number' || body.max_occupancy < 1)
    return badRequest('max_occupancy must be >= 1');
  if (typeof body.bed_count !== 'number' || body.bed_count < 1)
    return badRequest('bed_count must be >= 1');

  try {
    const roomType = await createRoomType(env.DB, {
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
      base_rate_minor: Math.floor(body.base_rate_minor),
      currency_code: body.currency_code.trim().toUpperCase(),
      max_occupancy: body.max_occupancy,
      bed_count: body.bed_count,
      bed_type: body.bed_type?.trim() ?? null,
    });
    return json(roomType, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return conflict('A room type with that name already exists');
    throw err;
  }
};

export const getRoomTypeHandler: Handler = async (_req, params, env) => {
  const roomType = await getRoomType(env.DB, params['id']!);
  if (!roomType) return notFound('Room type');
  return json(roomType);
};

export const updateRoomTypeHandler: Handler = async (req, params, env) => {
  type Body = Partial<Omit<RoomType, 'id' | 'created_at' | 'updated_at'>>;
  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');

  if ('base_rate_minor' in body && (typeof body.base_rate_minor !== 'number' || body.base_rate_minor < 0))
    return badRequest('base_rate_minor must be a non-negative integer');
  if ('max_occupancy' in body && (typeof body.max_occupancy !== 'number' || body.max_occupancy < 1))
    return badRequest('max_occupancy must be >= 1');
  if ('bed_count' in body && (typeof body.bed_count !== 'number' || body.bed_count < 1))
    return badRequest('bed_count must be >= 1');
  if ('is_active' in body && body.is_active !== 0 && body.is_active !== 1)
    return badRequest('is_active must be 0 or 1');

  try {
    const updated = await updateRoomType(env.DB, params['id']!, body);
    if (!updated) return notFound('Room type');
    return json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return conflict('A room type with that name already exists');
    throw err;
  }
};
