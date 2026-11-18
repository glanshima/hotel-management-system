/**
 * Routes: Guests
 *
 * GET    /guests              — List all guests.
 * GET    /guests?search=term  — Search guests by name or email.
 * POST   /guests              — Create a guest profile.
 * GET    /guests/:id          — Get a specific guest.
 * PATCH  /guests/:id          — Update a guest profile.
 */

import { json, notFound, badRequest, conflict, parseBody } from '../router';
import { listGuests, getGuest, searchGuests, createGuest, updateGuest } from '../db';
import type { Env, Guest, GuestIdType } from '../types';

const VALID_ID_TYPES: GuestIdType[] = ['passport', 'national_id', 'drivers_license', 'other'];

type Handler = (req: Request, params: Record<string, string>, env: Env) => Promise<Response>;

export const listGuestsHandler: Handler = async (req, _params, env) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('search');
  if (search?.trim()) {
    const results = await searchGuests(env.DB, search.trim());
    return json(results);
  }
  const guests = await listGuests(env.DB);
  return json(guests);
};

export const createGuestHandler: Handler = async (req, _params, env) => {
  type Body = {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    id_type?: GuestIdType;
    id_number?: string;
    nationality?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    country?: string;
    postal_code?: string;
    notes?: string;
  };

  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');
  if (!body.first_name?.trim()) return badRequest('first_name is required');
  if (!body.last_name?.trim()) return badRequest('last_name is required');

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return badRequest('email format is invalid');
  }
  if (body.id_type && !VALID_ID_TYPES.includes(body.id_type)) {
    return badRequest(`id_type must be one of: ${VALID_ID_TYPES.join(', ')}`);
  }

  try {
    const guest = await createGuest(env.DB, {
      first_name: body.first_name.trim(),
      last_name: body.last_name.trim(),
      email: body.email?.trim() ?? null,
      phone: body.phone?.trim() ?? null,
      id_type: body.id_type ?? null,
      id_number: body.id_number?.trim() ?? null,
      nationality: body.nationality?.trim().toUpperCase() ?? null,
      address_line1: body.address_line1?.trim() ?? null,
      address_line2: body.address_line2?.trim() ?? null,
      city: body.city?.trim() ?? null,
      country: body.country?.trim().toUpperCase() ?? null,
      postal_code: body.postal_code?.trim() ?? null,
      notes: body.notes?.trim() ?? null,
    });
    return json(guest, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return conflict('A guest with that email already exists');
    throw err;
  }
};

export const getGuestHandler: Handler = async (_req, params, env) => {
  const guest = await getGuest(env.DB, params['id']!);
  if (!guest) return notFound('Guest');
  return json(guest);
};

export const updateGuestHandler: Handler = async (req, params, env) => {
  type Body = Partial<Omit<Guest, 'id' | 'created_at' | 'updated_at'>>;
  const body = await parseBody<Body>(req);
  if (!body) return badRequest('Invalid JSON body');

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return badRequest('email format is invalid');
  }
  if (body.id_type && !VALID_ID_TYPES.includes(body.id_type)) {
    return badRequest(`id_type must be one of: ${VALID_ID_TYPES.join(', ')}`);
  }

  try {
    const updated = await updateGuest(env.DB, params['id']!, body);
    if (!updated) return notFound('Guest');
    return json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return conflict('A guest with that email already exists');
    throw err;
  }
};
