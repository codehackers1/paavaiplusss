# Paavai+ 🎓

**Anonymous participation. Admin access only.**

A production-oriented, privacy-first, **college-only** student engagement
platform for a single institution. Students browse events, react with
Interested / Not-Interested meters, participate in **anonymous polls** (one
vote per device, live results), and read announcements — **all without an
account, and without the platform storing any personal data**. Administrators
manage events, polls and announcements behind a gated dashboard with KPIs,
trends, deterministic rule-based AI insights and CSV export.

> **Status of this codebase:** full source, schema, migration and tests are
> included. Everything below is the *implemented* design; anything that could
> not be verified in this environment is **explicitly marked** (see
> [Implementation status](#implementation-status)). **No test is claimed to have
> passed unless it was executed here** — see [Testing](#testing).

---

## Table of contents

- [Scope & non-negotiables](#scope--non-negotiables)
- [Stack](#stack)
- [Architecture](#architecture)
- [Privacy by design](#privacy-by-design)
- [Features](#features)
- [Getting started (local)](#getting-started-local)
- [Environment variables](#environment-variables)
- [Database & seeding](#database--seeding)
- [Scripts](#scripts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Implementation status](#implementation-status)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)

---

## Scope & non-negotiables

| Requirement | How it is met |
| --- | --- |
| Zero login, zero personal data for students | The entire student-facing portal (events, polls, announcements) works anonymously. There is **no student account, no roster, no registration** — nothing personal is collected to browse, react or vote. |
| Anonymous event meters | Each browser holds one opaque, HttpOnly `paavai_anon` cookie; only the peppered SHA-256 hash of it (`visitorHash`) is stored. Re-submitting the same direction toggles the reaction off; unique `(eventId, visitorHash)`. |
| One vote per device per poll | A poll-scoped, one-use credential is issued per `(pollId, visitorHash)` and consumed via compare-and-swap inside a `Serializable` transaction. The unique `(pollId, visitorHash)` constraint and the privacy guard test enforce it structurally. |
| PII-free ballots | `poll_ballots` / `ballot_choices` store **no** visitor, student or user reference. A regression-guard test fails the suite if this is ever violated. |
| Admin gated, no student auth | Only administrators sign in (`/login`). `/register` and student auth surfaces are removed. The `/admin` area is protected by middleware **and** re-checked by every server action / API route. |
| Real data, deterministic insights | All dashboard KPIs, trends and insights are computed from database aggregates. Insights are a pure rule engine (`lib/analytics/insights.ts`) — no external API, no mock data. |
| Never claim unverified tests | Unit tests were executed in this environment (results below). Integration/e2e suites require live PostgreSQL + a running app and are **not claimed as executed**. |

---

## Stack

- **Next.js 15.5** (App Router, React 19, server components by default, `force-dynamic` pages)
- **TypeScript** (strict)
- **Tailwind CSS v4** + an editorial visual identity
- **PostgreSQL** via **Prisma ORM 6**
- **Zod v4** validation
- **next-auth v5** (Credentials, JWT sessions + DB-backed revocation — admins only)
- **Recharts** (analytics), **GSAP + motion** (editorial motion)
- **Vitest** (unit), **Playwright** (e2e)

---

## Architecture

```
app/
  (portal)/           public, anonymous student experience: home, events, polls, announcements, about, privacy, accessibility
  (auth)/             administrator sign-in only
  admin/              gated dashboard: KPIs + insights, events, polls, announcements, analytics, audit, settings
  api/
    auth/[...nextauth]
    anon/session      ensure the anonymous device cookie + hash
    events, events/[id]/interest
    polls, polls/[id]/eligibility | vote | results
    announcements
    admin/analytics/export (CSV)
lib/
  services/           DB-backed business logic (the only layer that touches Prisma)
  anonymous/          per-device anonymous identity (cookie token → peppered hash)
  security/           scrypt passwords, AES-GCM TOTP-secret encryption, TOTP, hashing, rate limiting
  voting/             pure poll/voting rules + one-use credential tokens
  analytics/          pure metric formulas + deterministic insight rules
  validation/         Zod schemas shared by forms, actions and API routes
  auth/               permission model (ADMIN only) + session helpers
components/           UI primitives, admin forms, charts, motion
middleware.ts         route protection (UX guard; server actions are the boundary)
prisma/               schema, seed, migration
```

Route groups: `(portal)` is public and anonymous; `(auth)` is the administrator
sign-in; `/admin/*` requires an administrative permission (middleware guard,
re-verified by every server action and API route). Pages are `force-dynamic`:
the production build type-checks without a database.

---

## Privacy by design

The device's identity and the device's choices are deliberately separated.

1. **Identity** — the first anonymous interaction sets one `paavai_anon`
   cookie (random 32-byte token, HttpOnly, SameSite=Lax). Only the peppered
   SHA-256 hash of that token (`visitorHash`) is ever persisted. The raw token
   is never sent to the server body, logging, or analytics.
2. **Eligibility** — a visitor requests `POST /api/polls/[id]/eligibility`
   once per open poll, scoped by their `visitorHash`. The server stores only
   the SHA-256 hash of a one-use, 30-minute credential
   (`poll_eligibility_tokens.tokenHash`).
3. **Voting** — `POST /api/polls/[id]/vote` atomically consumes the credential
   (compare-and-swap on `consumedAt: null`, `Serializable` isolation) and
   writes a ballot. The ballot row contains **no visitor, student or user
   reference**.
4. **Results** — counts are computed from ballots only. Visibility is enforced
   server-side per the poll's `resultsVisibility` policy. No voter identity is
   ever shown in results or anywhere in the admin UI.

What this does **not** provide, and is documented honestly in
[docs/PRIVACY.md](docs/PRIVACY.md): per-device de-duplication is best-effort —
clearing cookies, private browsing, or shared machines can cast more than one
vote, and an operator with live access to `poll_eligibility_tokens` could join
a credential to its poll at vote time. This is an explicit, documented
limitation of collecting no identity, not a claim.

---

## Features

**Students (no account, no data)**
- Discover events (search, category filters), react with an anonymous
  Interested / Not-Interested meter; counts update live, per device.
- Browse anonymous polls; every visitor is eligible, one vote per device, with
  **live results** when the poll's visibility policy allows.
- Announcements feed; about / privacy / accessibility pages.

**Administrators**
- Gated dashboard: **KPIs** (Reach, Total Events, Active Polls, Avg Engagement)
  each with a 30-day % trend vs the previous period, **deterministic AI
  insights** computed from live aggregates, and quick actions.
- Full CRUD + lifecycle transitions for events, polls, announcements.
- Polls: multi-choice, timing window, results-visibility policy, one-vote-per-
  device enforcement, anonymous participation metrics (ballots ÷ reach).
- Analytics page with trends, category comparison, top events, poll
  performance, and CSV export.
- Audit log, settings (poll defaults, retention, email), scrypt-hashed admin
  passwords, optional TOTP MFA, rate limiting, and DB-backed session
  revocation.

---

## Getting started (local)

Prerequisites: **Node 20.9+**, **PostgreSQL 14+** (or Docker):

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env        # then fill in real values (see below)

# 3. Create the database schema
npx prisma migrate deploy

# 4. Seed roles + administrator (a real SEED_ADMIN_PASSWORD is required)
npm run prisma:seed

# 5. Run
npm run dev                 # http://localhost:3000
```

Students just open the site — there is nothing to sign up for.

Optional synthetic demo fixtures (clearly labelled `[DEMO]`): demo events, an
open demo poll with pre-voted ballots and pending credentials, anonymous
visitors, reactions and view analytics:

```bash
SEED_DEMO_DATA=true npm run prisma:seed
```

> **No database is required** to run `npm run typecheck`, `npm run build` or
> `npm test` (unit) — see [Testing](#testing).

---

## Environment variables

All variables are documented in [`.env.example`](.env.example) and read
centrally through [`lib/env.ts`](lib/env.ts). Key ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session-signing secret (generate 32 bytes) — for admin sessions |
| `AUTH_URL` | Public base URL of the deployment |
| `NEXT_PUBLIC_COLLEGE_NAME` / `_SHORT_NAME` | Institutional identity (edit for this college) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Support contact shown in the footer |
| `APP_TIMEZONE` | IANA timezone for all poll/event boundaries |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | First administrator |
| `SETTINGS_ENCRYPTION_KEY` | 32-byte base64 key encrypting admin TOTP secrets at rest |
| `AUTH_MAX_ATTEMPTS` / `AUTH_WINDOW_MINUTES` | Login rate limiting |
| `AUDIT_HASH_PEPPER` | Pepper for hashing IPs/agents in logs |
| `VISITOR_HASH_PEPPER` | Pepper for anonymous visitor hashes — keep secret and stable |
| `EMAIL_PROVIDER` / `EMAIL_FROM` / `RESEND_API_KEY` | **Optional** announcement email delivery (disabled when blank) |
| `TEST_DATABASE_URL` / `E2E_BASE_URL` / `E2E_ADMIN_*` | Test infrastructure (suites skip when unset) |

---

## Database & seeding

- Schema: [`prisma/schema.prisma`](prisma/schema.prisma)
- Initial migration: `prisma/migrations/20261011000000_init/`
- Seed: [`prisma/seed.ts`](prisma/seed.ts) — upserts the ADMIN role, creates
  the first administrator, and (optionally) labelled anonymous demo fixtures.

There is **no Student model**. The anonymous tables store only hashes and
timestamps; ballots carry no identity by construction.

A `docker-compose.yml` (Postgres) is included for local development convenience.

---

## Scripts

```bash
npm run dev                 # next dev
npm run build               # production build (type-checks)
npm run start               # next start
npm run lint                # ESLint (separate from build; see below)
npm run typecheck           # tsc --noEmit
npm run test                # vitest run (unit + DB-gated integration)
npm run test:unit           # vitest run tests/unit
npm run test:integration    # vitest run tests/integration (needs TEST_DATABASE_URL)
npm run test:coverage       # vitest run --coverage
npm run test:e2e            # playwright test (needs a running, seeded app)
npm run prisma:generate     # prisma generate
npm run prisma:migrate      # prisma migrate deploy
npm run prisma:migrate:dev  # prisma migrate dev
npm run prisma:seed         # tsx prisma/seed.ts
```

Note: `next.config.ts` sets `eslint.ignoreDuringBuilds: true` — linting is run
separately (`npm run lint`) so CI can gate on either independently.

---

## Testing

### Executed in this environment ✅ (2026-10-11)

| Check | Command | Result |
| --- | --- | --- |
| Type checking | `npm run typecheck` | ✅ 0 errors (`tsc --noEmit`, strict) |
| Lint | `npm run lint` | ✅ exit 0 — "No ESLint warnings or errors" |
| Production build | `npm run build` | ✅ exit 0 — all routes compiled (ƒ dynamic) |
| Unit tests | `npm run test` | ✅ **167 passed** across 16 files; 4 integration cases skipped (DB-gated, as designed) |
| Prisma validate + generate | `npx prisma validate` / `npx prisma generate` | ✅ exit 0 |

### Unit (pure logic, no database) ✅

Covered: anonymous identity (token format, non-reversible peppered hash),
poll/voting rules, credential tokens, event lifecycle rules, announcement
rules, analytics formulas, **deterministic AI-insight rules**, permission model
(ADMIN-only), timezone handling, TOTP (RFC 4226 reference vectors), hashing,
CSV parse/serialise, utils, validation helpers, and the **schema-level privacy
regression guard** (`tests/unit/privacy-schema.test.ts`).

### Integration (DB-gated, not executed here ❌)

`tests/integration/voting-service.test.ts` exercises the anonymous voting flow
against PostgreSQL (one credential per device, one ballot per credential,
replay rejected, credential rotation, ballot carries no visitor/user
identifier). It **requires** `TEST_DATABASE_URL` and is skipped otherwise — it
is not claimed to have passed in this environment.

### End-to-end (app-gated, not executed here ❌)

`tests/e2e/smoke.spec.ts` (anonymous browse without sign-in, admin redirect to
login, anonymous interest + vote, admin dashboard after sign-in) self-skips
unless `E2E_BASE_URL` is set. Requires a built, running, seeded instance.

---

## Deployment

1. Provision **managed PostgreSQL** and set `DATABASE_URL`.
2. Set a real `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `AUDIT_HASH_PEPPER`,
   and a stable `VISITOR_HASH_PEPPER`.
3. Configure institutional values (`NEXT_PUBLIC_COLLEGE_*`,
   `NEXT_PUBLIC_SUPPORT_EMAIL`, `APP_TIMEZONE`).
4. `npm ci && npm run build`.
5. `npx prisma migrate deploy && npm run prisma:seed` (seed once, admin only).
6. Run with `npm run start` (or on a platform with the Node runtime — this is a
   long-running, single-tenant app with a Postgres DB).

See [docs/INSTITUTION-CONFIG.md](docs/INSTITUTION-CONFIG.md) for the go-live
checklist. **College-only access is a deployment-level control**: the portal is
anonymous by design, so restricting it to the campus network (VPN / SSO at the
edge / reverse-proxy allow-list) is the operator's responsibility —
documented in the privacy docs.

---

## Implementation status

This table **deliberately distinguishes implemented, tested, and
not-verified**, per the integrity requirement.

| Area | Implemented | Executed here | Notes |
| --- | --- | --- | --- |
| Source (full app) | ✅ | — | Next 15 App Router, strict TS |
| Prisma schema + initial migration (anonymous model) | ✅ | — | SQL generated offline via `prisma migrate diff --from-empty` |
| `npm install` + `prisma generate`/`validate` | ✅ | ✅ | exit 0 |
| Type checking (`tsc --noEmit`) | — | ✅ | passed, 0 errors |
| Lint (`next lint`) | — | ✅ | passed, exit 0 |
| Production build (`next build`) | — | ✅ | passed, exit 0, all routes compiled |
| Unit tests | ✅ written | ✅ | **167 passed / 16 files** (4 DB-gated integration cases skipped) |
| Integration tests (anonymous voting flow) | ✅ written | ❌ | requires `TEST_DATABASE_URL` / live Postgres — unavailable here (skipped cleanly by design) |
| E2E tests | ✅ written | ❌ | requires built+seeded running app — unavailable here |
| DB migration applied to a real Postgres | ✅ SQL | ❌ | no PostgreSQL/Docker/psql available in this environment |
| Email delivery integration | ✅ wiring | ❌ | `EMAIL_*`/`RESEND_API_KEY` not configured; feature disabled by default |

---

## Known limitations

- **Per-device voting is best-effort.** Clearing cookies, private browsing, or
  a shared machine can circumvent the one-vote-per-device rule — an
  unavoidable consequence of collecting no identity. This is not a substitute
  for a verified ballot; it is documented in docs/PRIVACY.md.
- **Operator join at vote time** (credential issuance/consumption timestamps
  vs ballot timestamps) is possible for an operator with live database access.
- **College-only access is deployment-level**: no in-app mechanism restricts
  the public portal to the campus network.
- **Retention settings** (analytics/audit) and **announcement email delivery**
  are stored and surfaced in Settings but are reserved for operation; they are
  managed by the ops team until a scheduler/queued worker is added.
- **Demo fixtures** exist only when `SEED_DEMO_DATA=true` and are prefixed
  `[DEMO]`/`DEMO-`.
- Password hashing uses Node `scrypt`; **Argon2id** is documented as the
  recommended upgrade path (`lib/security/passwords.ts`).

---

## Documentation

- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, hardening, upgrade path
- [`docs/PRIVACY.md`](docs/PRIVACY.md) — data model, retained data, residual risk
- [`docs/INSTITUTION-CONFIG.md`](docs/INSTITUTION-CONFIG.md) — go-live checklist