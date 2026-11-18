/**
 * Routes: Hotel configuration
 * (c)SIDGAKS Tech
 *
 * GET  /config   — Retrieve the hotel configuration.
 * PATCH /config  — Update one or more configuration fields.
 */

import { json, notFound, badRequest, parseBody } from '../router';
import { getHotelConfig, updateHotelConfig } from '../db';
import type { Env, HotelConfig } from '../types';

type Handler = (req: Request, params: Record<string, string>, env: Env) => Promise<Response>;

/** Fields that callers may send in a PATCH /config request. */
const ALLOWED_CONFIG_FIELDS: ReadonlySet<string> = new Set([
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

const TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Basic check that a string looks like a plausible IANA timezone. */
function isPlausibleTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  // Must contain at least one slash (e.g. "Asia/Bangkok") or be "UTC"
  if (tz === 'UTC') return true;
  if (!/^[A-Za-z_]+\/[A-Za-z_/]+$/.test(tz)) return false;
  // Runtime validation: attempt to use it
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const getConfig: Handler = async (_req, _params, env) => {
  const config = await getHotelConfig(env.DB);
  if (!config) return notFound('Hotel configuration');
  return json(config);
};

export const patchConfig: Handler = async (req, _params, env) => {
  type PatchBody = Partial<Omit<HotelConfig, 'id' | 'created_at' | 'updated_at'>>;
  const body = await parseBody<PatchBody>(req);
  if (!body || typeof body !== 'object') return badRequest('Invalid JSON body');

  // Reject any fields not in the allowlist
  const unknownFields = Object.keys(body).filter((k) => !ALLOWED_CONFIG_FIELDS.has(k));
  if (unknownFields.length > 0) {
    return badRequest(`Unknown or protected field(s): ${unknownFields.join(', ')}`);
  }

  // Validate time fields
  const timeFields = ['checkin_time', 'checkout_time', 'noshow_cutoff_time'] as const;
  for (const field of timeFields) {
    if (field in body) {
      if (typeof body[field] !== 'string' || !TIME_HH_MM.test(body[field] as string)) {
        return badRequest(`${field} must be in HH:MM 24-hour format`);
      }
    }
  }

  // Validate timezone
  if ('timezone' in body) {
    if (!isPlausibleTimezone(body.timezone as string)) {
      return badRequest('timezone must be a valid IANA timezone identifier (e.g. "Asia/Bangkok")');
    }
  }

  // Validate default_cancellation_hours
  if ('default_cancellation_hours' in body) {
    const h = body.default_cancellation_hours;
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 1) {
      return badRequest('default_cancellation_hours must be a positive integer');
    }
  }

  // Validate string fields are actually strings
  const stringFields = [
    'hotel_name', 'address_line1', 'address_line2', 'city', 'country',
    'postal_code', 'phone', 'email', 'currency_code',
  ] as const;
  for (const field of stringFields) {
    if (field in body && body[field] !== null && typeof body[field] !== 'string') {
      return badRequest(`${field} must be a string`);
    }
  }

  const updated = await updateHotelConfig(env.DB, body);
  if (!updated) return notFound('Hotel configuration');
  return json(updated);
};
