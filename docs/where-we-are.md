# Hotel Management System — Where We Are
(c)SIDGAKS Tech

**Document date:** 2026-11-14  
**Branch:** `feat/database-implementation`  
**Commit:** `88e5869`  
**Repository:** https://github.com/glanshima/hotel-management-system  
**Blueprint baseline:** Hotel Blueprint v1.3

---

## 1. Project Overview

The Hotel Management System is a reusable application that can be independently deployed for different hotels. Each hotel runs its own instance with its own isolated database. There is no shared database, no multi-tenancy, and no `tenant_id` architecture.

| Component | Technology |
|---|---|
| Backend / API | Cloudflare Workers (TypeScript) |
| Database | Cloudflare D1 (SQLite at the edge) |
| File storage | Cloudflare R2 (planned, not yet implemented) |
| Frontend | Not yet started |
| Local development | Windows / PowerShell / Node.js 24 |
| Repository | GitHub — `glanshima/hotel-management-system` |

---

## 2. What Has Been Done

### 2.1 Database Design Document

A complete database design document was produced and approved by the agent team. It is stored at `docs/database-design.md` and covers:

- Architecture decisions and compliance rationale
- Entity relationship diagram (Mermaid)
- Full data dictionary for every table
- Reservation lifecycle design
- Double-booking prevention strategy
- Date and time handling
- Security and data privacy considerations
- Migration strategy
- Seed and reference data
- Testing requirements
- Implementation roadmap
- Assumptions and open decisions awaiting owner approval

### 2.2 Phase A — Foundation Database and API

Phase A is **fully implemented and pushed** to `origin/feat/database-implementation`.

#### Database Migrations (`worker/migrations/`)

Seven migrations create the complete Phase A schema:

| File | Purpose |
|---|---|
| `0001_create_hotel_config.sql` | Hotel configuration singleton (one row per deployment) |
| `0002_create_room_types.sql` | Room category definitions with pricing |
| `0003_create_rooms.sql` | Physical rooms with operational status |
| `0004_create_guests.sql` | Guest profiles with PII fields |
| `0005_create_reservations.sql` | Central booking entity with full lifecycle support |
| `0006_create_reservation_status_log.sql` | Immutable audit trail of every status change |
| `0007_seed_hotel_config.sql` | Seeds approved operational defaults |

Seeded defaults:

| Setting | Value |
|---|---|
| Check-in time | 14:00 (hotel local time) |
| Check-out deadline | 12:00 (early checkout permitted) |
| No-show cutoff | 23:00 (hotel local time) |
| Currency | THB |
| Timezone | Asia/Bangkok |

#### API Worker (`worker/src/`)

| File | Purpose |
|---|---|
| `types.ts` | All TypeScript interfaces: HotelConfig, RoomType, Room, Guest, Reservation, ReservationStatusLog, Env, ALLOWED_TRANSITIONS |
| `db.ts` | All D1 database queries. Enforces PRAGMA FK ON, field allowlists on every update, atomic capacity-guarded INSERT, conditional status-log INSERT |
| `router.ts` | Minimal URLPattern-based HTTP router |
| `routes/config.ts` | `GET /config`, `PATCH /config` |
| `routes/roomTypes.ts` | Full CRUD for room types |
| `routes/rooms.ts` | Full CRUD + `GET /rooms/availability` |
| `routes/guests.ts` | Full CRUD + search by name or email |
| `routes/reservations.ts` | Full reservation lifecycle |
| `index.ts` | Worker entry point, CORS, error handler |

#### API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/config` | Get hotel configuration |
| PATCH | `/config` | Update hotel configuration |
| GET | `/room-types` | List active room types |
| POST | `/room-types` | Create a room type |
| GET | `/room-types/:id` | Get a room type |
| PATCH | `/room-types/:id` | Update or deactivate a room type |
| GET | `/rooms/availability` | Check availability for a room type and date range |
| GET | `/rooms` | List rooms |
| POST | `/rooms` | Create a room |
| GET | `/rooms/:id` | Get a room |
| PATCH | `/rooms/:id` | Update a room |
| GET | `/guests` | List or search guests |
| POST | `/guests` | Create a guest |
| GET | `/guests/:id` | Get a guest |
| PATCH | `/guests/:id` | Update a guest |
| GET | `/reservations` | List reservations |
| POST | `/reservations` | Create a reservation |
| GET | `/reservations/:id` | Get a reservation |
| PATCH | `/reservations/:id/confirm` | Confirm a pending reservation |
| PATCH | `/reservations/:id/cancel` | Cancel a reservation |
| PATCH | `/reservations/:id/no-show` | Mark as no-show (enforces 23:00 cutoff) |
| PATCH | `/reservations/:id/check-in` | Check in a guest (enforces 14:00 start) |
| PATCH | `/reservations/:id/check-out` | Check out a guest (early checkout permitted) |
| PATCH | `/reservations/:id/assign-room` | Assign a specific room |
| GET | `/reservations/:id/status-log` | Full status transition history |

#### Reservation Lifecycle

```
pending → confirmed → checked_in → checked_out  (normal flow)
pending → cancelled                              (before arrival)
confirmed → cancelled                            (before arrival)
confirmed → no_show                              (after 23:00 on checkin date)
```

All other transitions are rejected with HTTP 422.

#### Business Rules Enforced

- Check-in blocked before 14:00 hotel local time (staff can pass `staff_override: true` as a development placeholder — this must be replaced with real auth in Phase B)
- Early checkout permitted at any time
- No-show blocked before 23:00 hotel local time and before the reservation's check-in date
- Room must be `available` (cleaned and marked ready) before check-in — same-day turnover works only after housekeeping is complete
- Room assigned to a reservation must belong to the reservation's room type
- Occupancy (adults + children) checked against room type maximum
- Pending reservations hold room capacity — cannot double-allocate a room to a conflicting pending reservation
- Confirmation rechecks capacity before transitioning from pending
- Atomic double-booking prevention via SQLite `INSERT … SELECT … WHERE (count) < capacity` guard

#### Security

- All update operations use explicit field allowlists — user-supplied field names cannot inject arbitrary SQL columns
- Internal error details are never returned to API clients — errors are logged server-side only
- CORS uses a controlled origin list (`http://localhost:3000`, `http://localhost:5173`) — not a wildcard
- Guest PII (passport numbers, addresses) is stored but not encrypted at rest — pending owner decision
- No plaintext passwords anywhere in Phase A (users table does not exist yet)

#### Test Suite (`worker/test/index.spec.ts`)

62 automated tests across 8 describe blocks, using the Cloudflare vitest plugin against a real local D1/SQLite instance:

| Block | Tests | Coverage |
|---|---|---|
| DB: Schema verification | 4 | Tables, indexes, seed defaults, CHECK constraint |
| Guests | 5 | CRUD, duplicate email, required fields |
| Room Types | 4 | CRUD, duplicate name, negative rate, deactivation |
| Rooms | 7 | CRUD, FK constraints, wrong type assignment, inactive room |
| Reservations | 21 | Full lifecycle, overlap, occupancy, same-day turnover, capacity regression |
| Operational rules | 7 | Check-in time, early checkout, no-show cutoff, config validation |
| Referential integrity | 4 | RESTRICT and CASCADE FK behaviour |
| Validation and Security | 10 | Invalid input, protected fields, error response safety, CORS |

---

## 3. What Has NOT Been Done

### 3.1 Phase B — Not Started

| Module | Status |
|---|---|
| Users and authentication | ❌ Not started |
| Roles and permissions | ❌ Not started |
| Check-in / check-out hardening (real auth) | ❌ Not started |
| Housekeeping task management | ❌ Not started |
| Payments and billing | ❌ Not started |
| Invoicing | ❌ Not started |
| Audit logs | ❌ Not started |
| Notifications (email / SMS) | ❌ Not started |
| Reporting and analytics | ❌ Not started |
| Guest history | ❌ Not started |
| OTA channel integration | ❌ Not started |

### 3.2 Frontend

Not started. The API is ready to be consumed but no frontend exists.

### 3.3 Production Deployment

Not configured. The `wrangler.jsonc` contains a placeholder `database_id`. A real D1 database has not been created on Cloudflare yet.

### 3.4 D1 Database on Cloudflare

Not created. All work so far is local only. No remote D1 database exists.

---

## 4. What to Do Next — Immediate Actions

These must happen in order before Phase B begins.

### Step 1 — Run the test suite on your machine

The agent environment uses Node.js 19 and cannot run the tests. You have Node.js 24.22.2. Run these commands from `worker/`:

```powershell
npm install
npx wrangler d1 migrations apply hotel-management-db --local
npx tsc --noEmit
npm test -- --run
```

Expected: 62 tests pass, 0 fail, 0 TypeScript errors.

If anything fails, report the exact error output. It will be diagnosed and fixed immediately before proceeding.

### Step 2 — Create the Cloudflare D1 database

```powershell
npx wrangler d1 create hotel-management-db
```

Copy the returned `database_id` and update `worker/wrangler.jsonc`:

```jsonc
"database_id": "<paste the real id here>"
```

Then regenerate the TypeScript bindings:

```powershell
npm run cf-typegen
```

### Step 3 — Apply migrations to the remote D1 database

```powershell
npx wrangler d1 migrations apply hotel-management-db --remote
```

### Step 4 — Deploy the Worker

```powershell
npm run deploy
```

### Step 5 — Smoke test the live API

```powershell
curl https://hotel-management-api.<your-subdomain>.workers.dev/health
```

Expected: `{"status":"ok","note":"development build — no auth"}`

### Step 6 — Merge this branch to main

Once the tests pass and the live deployment is confirmed:

- Open a pull request on GitHub from `feat/database-implementation` into `main`, or
- Tell the agent to merge it directly

---

## 5. Decisions Required from the Owner

The following business decisions have not been made. Phase B design depends on them.

| # | Decision | Why It Matters |
|---|---|---|
| P-01 | Should reception-created reservations start as `confirmed` or `pending`? | Affects the standard reception workflow and confirmation email logic |
| P-02 | Can a no-show reservation be reinstated, or must a new reservation be created? | Affects the no-show handler and status transition design |
| P-03 | Is there a cancellation fee? If so, what is the policy and amount? | Affects the payments module and cancellation endpoint |
| P-04 | Should no-shows be automatically marked at 23:00 by a scheduled Cloudflare Cron Trigger, or manually by staff? | Affects Phase B infrastructure design |
| P-05 | Should `guests.id_number` (passport/national ID) be encrypted at rest? | Affects security design and key management |
| P-06 | What is the data retention period for guest PII? | Required for GDPR / Thai PDPA compliance |
| P-07 | Does an online booking require payment to transition from `pending` to `confirmed`, or is manual staff confirmation sufficient? | Affects booking flow design and payment integration scope |
| P-08 | Is OTA (Booking.com, Agoda) channel manager integration in scope, and in which phase? | Affects booking source design |

---

## 6. Phase B — Recommended Sequence

Once the immediate steps above are complete and owner decisions are recorded, Phase B proceeds in this order:

### Stage B1 — Users and Authentication (prerequisite for everything else)

- `users` table: email, password hash (Argon2id), is_active
- `roles` table: Admin, Receptionist, Housekeeper, Accountant
- `role_permissions` table: permission codes per role
- Password hashing implementation
- Login endpoint returning a JWT or session token
- Authentication middleware applied to all existing endpoints
- Replace `staff_override: true` check-in placeholder with real authenticated staff session

**Nothing in Phase B can be properly secured until this stage is complete.**

### Stage B2 — Check-In / Check-Out Hardening

- Remove `staff_override` placeholder
- Enforce check-in time rule via authenticated staff role
- Audit-log every check-in and check-out event

### Stage B3 — Housekeeping

- `housekeeping_tasks` table
- Task created automatically on checkout (currently just sets room to `cleaning`)
- Housekeeper marks task complete → room moves to `available`
- Room status driven by task completion rather than manual PATCH

### Stage B4 — Payments and Billing

- `payments` table (processor token, amount in minor units, status)
- `invoices` table (reservation → invoice → payment lines)
- Payment recording against reservations
- No raw card numbers stored — payment processor tokenisation only
- Cancellation fee logic (pending P-03 decision)

### Stage B5 — Audit Logs

- `audit_logs` table (immutable, append-only)
- Write audit entries on all significant operations
- DELETE trigger to block tampering

### Stage B6 — Notifications

- `notifications` table
- Outbound email/SMS queue
- Reservation confirmation, cancellation, check-in notifications

### Stage B7 — Reporting

- Occupancy reports
- Revenue reports
- Guest history
- Database views or aggregation queries

---

## 7. Architecture Decisions Locked — Do Not Change

These are approved and must not be revisited without explicit owner decision:

1. One codebase, independent per-hotel deployment
2. No shared database, no `tenant_id`
3. Cloudflare Workers + D1 + R2
4. Check-in time: 14:00 hotel local
5. Check-out deadline: 12:00 hotel local (early checkout permitted)
6. No-show cutoff: 23:00 hotel local
7. Same-day room turnover only after cleaning and marked ready
8. Monetary values stored as integers in minor currency units
9. All timestamps stored as ISO 8601 UTC text
10. UUIDs (v4) as primary keys

---

## 8. File Map

```
hotel-management-system/
├── docs/
│   ├── database-design.md        ← Full database design document
│   ├── developer-setup.md        ← Setup, migration, auth boundary instructions
│   └── where-we-are.md           ← This document
├── worker/
│   ├── migrations/
│   │   ├── 0001_create_hotel_config.sql
│   │   ├── 0002_create_room_types.sql
│   │   ├── 0003_create_rooms.sql
│   │   ├── 0004_create_guests.sql
│   │   ├── 0005_create_reservations.sql
│   │   ├── 0006_create_reservation_status_log.sql
│   │   └── 0007_seed_hotel_config.sql
│   ├── src/
│   │   ├── db.ts                 ← All D1 queries and DB helpers
│   │   ├── index.ts              ← Worker entry point
│   │   ├── router.ts             ← HTTP router
│   │   ├── types.ts              ← Shared TypeScript interfaces
│   │   └── routes/
│   │       ├── config.ts
│   │       ├── guests.ts
│   │       ├── reservations.ts
│   │       ├── roomTypes.ts
│   │       └── rooms.ts
│   ├── test/
│   │   └── index.spec.ts         ← 62 integration tests
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.mts
│   ├── worker-configuration.d.ts ← Cloudflare Workers type reference
│   └── wrangler.jsonc            ← Wrangler config (D1 binding, migrations dir)
├── .gitignore
├── package.json
└── package-lock.json
```

---

## 9. Git History

| Commit | Description |
|---|---|
| `f726214` | Merge GitHub initial files with local project (baseline) |
| `88e5869` | feat: Phase A database schema, API, and tests (current) |

Branch `feat/database-implementation` is live on GitHub.  
`main` remains at `f726214` — untouched until testing is confirmed.

---

*Document prepared by the SIDGAKS Tech agent team.*  
*(c)SIDGAKS Tech*
