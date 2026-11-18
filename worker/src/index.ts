/**
 * Hotel Management System — Cloudflare Worker entry point.
 * (c)SIDGAKS Tech
 *
 * DEVELOPMENT STATUS:
 * This API has no authentication or authorisation layer.
 * It is a development-only build. It must NOT be deployed as a publicly
 * accessible production service until Phase B authentication is implemented.
 *
 * Routes requiring authentication before production use:
 *   ALL endpoints — authentication is required for every operation.
 *   Staff-only operations include: config updates, room management,
 *   reservation creation (reception), confirm, check-in, check-out, no-show.
 *   Guest-facing operations (online booking) require separate guest auth flow.
 *
 * See docs/developer-setup.md §Authentication Boundary for the full list.
 */

import { Router, json } from './router';
import type { Env } from './types';

import { getConfig, patchConfig } from './routes/config';
import {
  listRoomTypesHandler,
  createRoomTypeHandler,
  getRoomTypeHandler,
  updateRoomTypeHandler,
} from './routes/roomTypes';
import {
  listRoomsHandler,
  checkAvailabilityHandler,
  createRoomHandler,
  getRoomHandler,
  updateRoomHandler,
} from './routes/rooms';
import {
  listGuestsHandler,
  createGuestHandler,
  getGuestHandler,
  updateGuestHandler,
} from './routes/guests';
import {
  listReservationsHandler,
  createReservationHandler,
  getReservationHandler,
  confirmReservationHandler,
  cancelReservationHandler,
  noShowReservationHandler,
  checkInHandler,
  checkOutHandler,
  assignRoomHandler,
  statusLogHandler,
} from './routes/reservations';

// ---------------------------------------------------------------------------
// CORS configuration
// ---------------------------------------------------------------------------

/**
 * Allowed origins for cross-origin requests.
 *
 * In development this is permissive. In production this list must be tightened
 * to the actual frontend origin(s) before deployment.
 *
 * Configure via the ALLOWED_ORIGINS environment variable (comma-separated list)
 * once authentication is in place. Until then the development default applies.
 */
const DEV_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

function corsHeaders(origin: string | null, allowedOrigins: string[]): HeadersInit {
  const allowed =
    origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------

const router = new Router();

router.get('/health', () => json({ status: 'ok', note: 'development build — no auth' }));

router.get('/config', getConfig);
router.patch('/config', patchConfig);

router.get('/room-types', listRoomTypesHandler);
router.post('/room-types', createRoomTypeHandler);
router.get('/room-types/:id', getRoomTypeHandler);
router.patch('/room-types/:id', updateRoomTypeHandler);

router.get('/rooms/availability', checkAvailabilityHandler);
router.get('/rooms', listRoomsHandler);
router.post('/rooms', createRoomHandler);
router.get('/rooms/:id', getRoomHandler);
router.patch('/rooms/:id', updateRoomHandler);

router.get('/guests', listGuestsHandler);
router.post('/guests', createGuestHandler);
router.get('/guests/:id', getGuestHandler);
router.patch('/guests/:id', updateGuestHandler);

router.get('/reservations', listReservationsHandler);
router.post('/reservations', createReservationHandler);
router.get('/reservations/:id', getReservationHandler);
router.patch('/reservations/:id/confirm', confirmReservationHandler);
router.patch('/reservations/:id/cancel', cancelReservationHandler);
router.patch('/reservations/:id/no-show', noShowReservationHandler);
router.patch('/reservations/:id/check-in', checkInHandler);
router.patch('/reservations/:id/check-out', checkOutHandler);
router.patch('/reservations/:id/assign-room', assignRoomHandler);
router.get('/reservations/:id/status-log', statusLogHandler);

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, DEV_ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    let response: Response;
    try {
      response = await router.handle(request, env);
    } catch (err) {
      // Log the full error server-side only. Never expose internal details publicly.
      console.error('[hotel-api] Unhandled error:', err instanceof Error ? err.stack : err);
      response = json({ error: 'An internal error occurred. Please try again.' }, 500);
    }

    // Apply CORS to every response
    for (const [k, v] of Object.entries(cors)) {
      response.headers.set(k, v);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
