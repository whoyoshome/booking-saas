# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, Copilot, etc.) working in this repository. Read before changing code.

## Hard rules

1. **Never bypass Row Level Security.** Every query on a tenant-scoped table (`users`, `branches`, `services`, `staff`, `staff_services`, `staff_schedules`, `branch_schedules`, `bookings` and their exception tables) must go through `this.prisma.client.*`, never `this.prisma.*`. `this.prisma.client` is the RLS-scoped transaction opened by `TenantContextInterceptor`. The raw `this.prisma` connection is only legitimate in `AuthService` (identity is resolved before a tenant exists) and in the two system scripts (`prisma/seed.ts`, `bookings-cleanup.service.ts`) that use the `set_config('app.is_super_admin', 'true', true)` bypass. Do not add another caller of that bypass without asking.
2. **Never invent an endpoint.** If a task seems to need a new route, propose it and stop. Check `apps/api/src/*/*.controller.ts` for what actually exists.
3. **Never commit `.env` or real secrets** in a diff, commit message or generated file. `.env.example` documents the shape.
4. **Run the e2e suite before finishing a backend change:** `cd apps/api && npm run test:e2e` (79 tests, all green). Any change under `apps/api/src/**` is what this suite protects.
5. **Keep diffs minimal.** No reformatting, import reordering or unrelated rewrites.
6. **The stack is fixed.** Do not introduce GraphQL, MongoDB or any non-relational datastore, Terraform/OpenTofu, or an ORM other than Prisma. The AWS layout is designed but not applied; read `docs/aws-target.md` before touching anything AWS-related. If a task seems to require any of these, stop and ask.

## Architecture invariants

- **Two Postgres roles.** `DATABASE_URL` is `booking_app` (non-superuser, subject to RLS) and is the only runtime connection. `DATABASE_MIGRATE_URL` is `booking_admin` (owner) and is for migrations and admin scripts only. Never point runtime code at the migration URL.
- **`@TenantScoped()`** on every controller or route that touches tenant data. It combines `JwtAuthGuard`, `TenantGuard`, `RolesGuard` and `TenantContextInterceptor`; skipping it is a bug.
- **Double-booking prevention lives in PostgreSQL** (`EXCLUDE USING gist` on `bookings`, migration `add_bookings_constraints`). Never use an application-level `if (available) createBooking()` as the source of truth.
- **`GET /availability` and `POST /bookings` use different cache consistency modes on purpose** (`ignoreBookings: true` for the write check, `false` for reads). Do not merge them into one call; the split avoids TOCTOU flakiness under concurrency.
- **Time zones.** Schedule wall-clock times are stored as-is (`@db.Time` / `@db.Date`). Conversion to UTC instants happens only in `AvailabilityService`, via Luxon, against `branch.timezone`. No ad-hoc date arithmetic on schedules elsewhere.
- **`PENDING_TTL_MINUTES` is mirrored** in `apps/web/lib/alerts.ts` from `apps/api/src/bookings/bookings-cleanup.service.ts`. A web unit test fails if they diverge; change both together.
- **Alert priority is derived client-side** in `apps/web/lib/alerts.ts` from `GET /bookings` fields. Do not add a severity column or endpoint for it. Run `cd apps/web && npm test` after changing those rules.

## Before starting a task

1. Read the relevant section of `docs/design-decisions.md` for the reasoning behind the current design.
2. Check `docs/prompts/` for a template that matches the task.
3. If it is unclear whether a change counts as new scope, stop and ask.

## AI assist (`POST /ai/assist`)

Read-only assistant grounded through `this.prisma.client` on the tenant's `PENDING` bookings, with no write capability. Contract: `docs/ai-assist.md`. Any extension (more data sources, another LLM-backed endpoint) must keep the same pattern: explicit read-only grounding, a prompt that says to admit when the data does not contain the answer, a clear `503` when configuration is missing or the upstream fails, and the external call returned as an `AfterCommit` step so it runs outside the RLS transaction, with a timeout.

## Out of scope

Embeddings, vector stores and RAG over booking data are not on the roadmap. Treat any such request as new scope requiring explicit approval; do not add `pgvector`, an embedding pipeline or a vector database dependency.
