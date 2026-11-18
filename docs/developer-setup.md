# Hotel Management System — Developer Setup Guide
(c)SIDGAKS Tech

---

## ⚠️ Development Status

**This API has no authentication or authorisation layer.**

It must NOT be deployed as a publicly accessible production service until
Phase B authentication is implemented. See §Authentication Boundary below.

---

## Prerequisites

- Node.js >= 22 (required by wrangler v4 and vitest v5)
- npm >= 10
- A Cloudflare account with Workers and D1 access
- Wrangler CLI: `npx wrangler login`

## First-Time Setup

```bash
cd worker
npm install
```

## Create the D1 Database

```bash
npx wrangler d1 create hotel-management-db
```

Copy the `database_id` from the output and update `wrangler.jsonc`:

```jsonc
"database_id": "<paste id here>"
```

Regenerate the TypeScript bindings:

```bash
npm run cf-typegen
```

## Apply Migrations

### Local development

```bash
npx wrangler d1 migrations apply hotel-management-db --local
```

### Production (after owner authorisation only)

```bash
npx wrangler d1 migrations apply hotel-management-db --remote
```

**Never apply migrations to the remote production database without owner
authorisation. Always test in local development first.**

## Migration Order

Migrations must be applied in numeric order. Never reorder or modify applied
migrations. To roll back a change, create a new numbered migration that
reverses it.

```
0001_create_hotel_config.sql
0002_create_room_types.sql
0003_create_rooms.sql
0004_create_guests.sql
0005_create_reservations.sql        ← fixed table-level CHECK constraint
0006_create_reservation_status_log.sql
0007_seed_hotel_config.sql          ← inserts approved operational defaults
```

## Run the Development Server

```bash
npm run dev
```

API available at `http://localhost:8787`.

## Run Tests

```bash
npm test -- --run
```

The Cloudflare vitest plugin applies migrations automatically before the test
suite runs against a local in-memory D1 instance.

## Type Check

```bash
npm run cf-typegen   # regenerate worker-configuration.d.ts first
npx tsc --noEmit
```

## Deploy (after authentication is implemented)

```bash
npm run deploy
```

---

## Approved Operational Defaults

These defaults are seeded by migration 0007 and must be preserved:

| Setting | Approved value |
|---|---|
| Check-in time | 14:00 (hotel local time) |
| Check-out deadline | 12:00 (early checkout permitted) |
| No-show cutoff | 23:00 (hotel local time) |
| Same-day turnover | Permitted only after cleaning and marked ready |

Operational times are enforced relative to the hotel's configured IANA
timezone (`hotel_config.timezone`), not UTC.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/config` | Get hotel configuration |
| PATCH | `/config` | Update hotel configuration |
| GET | `/room-types` | List active room types |
| POST | `/room-types` | Create a room type |
| GET | `/room-types/:id` | Get a room type |
| PATCH | `/room-types/:id` | Update / deactivate a room type |
| GET | `/rooms` | List rooms |
| GET | `/rooms/availability` | Check room type availability |
| POST | `/rooms` | Create a room |
| GET | `/rooms/:id` | Get a room |
| PATCH | `/rooms/:id` | Update a room |
| GET | `/guests` | List / search guests |
| POST | `/guests` | Create a guest |
| GET | `/guests/:id` | Get a guest |
| PATCH | `/guests/:id` | Update a guest |
| GET | `/reservations` | List reservations |
| POST | `/reservations` | Create a reservation |
| GET | `/reservations/:id` | Get a reservation |
| PATCH | `/reservations/:id/confirm` | Confirm a reservation |
| PATCH | `/reservations/:id/cancel` | Cancel a reservation |
| PATCH | `/reservations/:id/no-show` | Mark as no-show |
| PATCH | `/reservations/:id/check-in` | Check in a guest |
| PATCH | `/reservations/:id/check-out` | Check out a guest |
| PATCH | `/reservations/:id/assign-room` | Assign a room |
| GET | `/reservations/:id/status-log` | Status transition history |

---

## Authentication Boundary

**Phase B — not yet implemented.**

The following routes require authentication and role-based authorisation
before the system can be operated in production:

| Route group | Minimum required role |
|---|---|
| `PATCH /config` | Admin |
| `POST /room-types`, `PATCH /room-types/:id` | Admin |
| `POST /rooms`, `PATCH /rooms/:id` | Admin or Housekeeper |
| `POST /guests`, `PATCH /guests/:id` | Receptionist |
| `GET /guests` | Receptionist |
| `POST /reservations` (reception) | Receptionist |
| `PATCH /reservations/:id/confirm` | Receptionist |
| `PATCH /reservations/:id/check-in` | Receptionist |
| `PATCH /reservations/:id/check-out` | Receptionist |
| `PATCH /reservations/:id/no-show` | Receptionist |
| `PATCH /reservations/:id/cancel` | Receptionist |
| `GET /reservations` | Receptionist |
| `POST /reservations` (online booking) | Guest (unauthenticated public flow) |

Guest personal data must not be accessible via unauthenticated public routes.

Staff `check-in` with `staff_override: true` is a placeholder for the Phase B
early-arrival override mechanism. In production, `staff_override` must require
an authenticated staff session and must be audit-logged.

---

## Implementation Status

### Completed (Phase A)

- Database schema: all 7 migrations
- hotel_config, room_types, rooms, guests, reservations, reservation_status_log
- All CHECK, UNIQUE, and FK constraints
- Full reservation lifecycle: pending → confirmed → checked_in → checked_out / cancelled / no_show
- Operational time enforcement: check-in from 14:00, no-show after 23:00
- Early checkout permitted without time restriction
- Same-day room turnover enforced (cleaning → available → check-in)
- Atomic capacity-guarded reservation creation
- Room-type consistency enforced at assignment and check-in
- Field allowlists on all update operations
- Controlled CORS origin list (dev defaults)
- Safe global error handler (no internal details in responses)

### Deferred (Phase B and later)

- User accounts and password hashing
- Role-based access control
- Authentication (JWT or session)
- Payments and invoicing
- Housekeeping task management
- Automated no-show marking (Cron Trigger)
- Notifications (email/SMS)
- Audit logging
- Reporting and analytics
- Guest history
- Multi-currency support
- OTA channel integration

### Decisions awaiting owner approval

- P-01: Whether reception bookings start as `confirmed` (currently `pending`)
- P-02: No-show reinstatement policy
- P-03: Cancellation fee policy and enforcement
- P-04: Automated no-show via Cron Trigger
- P-05: Application-layer encryption for `guests.id_number`
- P-06: Guest PII data retention period (GDPR/Thai PDPA)
- P-07: Whether online bookings require payment to confirm
- P-08: OTA channel manager integration scope

---

*Architecture baseline: Hotel Blueprint v1.3*
