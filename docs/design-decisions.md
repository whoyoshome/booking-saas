# Design decisions

The reasoning behind the current architecture: what was chosen, what was rejected, and which limitations are known and accepted. For setup and usage, see the [README](../README.md); for agent rules, see [AGENTS.md](../AGENTS.md).

## Repository and local environment

- **npm workspaces, no Turborepo/Nx.** With two apps there is no cross-package build cost to cache. Each app keeps its own lockfile, so CI installs with `npm ci --no-workspaces`.
- **Bind mount plus an anonymous `node_modules` volume.** Source is mounted for hot reload; `node_modules` stays inside the container so host-compiled native binaries (argon2, Prisma engines) never replace the Linux ones.
- **`depends_on: condition: service_healthy`.** Plain `depends_on` only orders process start. The healthcheck guarantees Postgres accepts connections before the API boots.
- **Services address each other by name** (`http://api:3001`), matching how containers resolve each other behind service discovery in production.
- **Development and production images are separate.** `Dockerfile` installs dev dependencies and runs in watch mode; `Dockerfile.prod` is multi-stage, runs as `node`, and exposes a `HEALTHCHECK` on `GET /health`. Migrations run outside the container, as in CI.

## Authentication

- **Two JWTs with separate secrets.** Access token (15 min) and refresh token (7 days) are signed with `JWT_SECRET` and `JWT_REFRESH_SECRET`. A leaked access token cannot be used to forge a refresh token.
- **Refresh token rotation with reuse detection.** Only an argon2id hash of the current refresh token is stored. Presenting an already-rotated token revokes the session.
- **Single active session per user.** One `refreshTokenHash` per user; signing in on a second device invalidates the first on its next refresh. Multi-device sessions would need a separate table and are not required yet.
- **Login resolves the tenant first.** `tenantSlug` selects the tenant, then the user is looked up through the composite unique `(tenantId, email)`. No slug means only a `SUPER_ADMIN` (`tenantId IS NULL`) can match.
- **One generic error for every login failure.** Wrong password, unknown email, unknown slug and suspended tenant all return the same message, and the not-found paths still run a dummy hash, so neither the response nor its timing reveals which tenants or users exist.
- **Accepted edge case.** PostgreSQL treats each `NULL` as distinct in a composite unique, so two super admins could share an email. Super admins are only created by the seed script, so no extra constraint was added.

## Multi-tenancy and Row Level Security

Isolation is enforced by PostgreSQL, not by application filters.

- **Request pipeline.** `@TenantScoped()` combines `JwtAuthGuard`, `TenantGuard`, `RolesGuard` and `TenantContextInterceptor`. The interceptor opens a transaction, sets `app.current_tenant_id` (or `app.is_super_admin`) with `set_config(..., true)`, and stores the transactional client in `AsyncLocalStorage`. Services read it through `PrismaService.client`, so no layer passes tenant context explicitly.
- **`set_config(name, value, true)` instead of `SET LOCAL`.** `SET LOCAL` cannot take bound parameters; `set_config` can, with identical transaction-local behavior.
- **`TenantGuard` is a gate, not a filter.** It rejects non-super-admin users without a tenant. Which rows are visible is decided only by RLS.
- **`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** `ENABLE` exempts the table owner from its own policies.
- **The runtime role is not a superuser.** Superusers bypass RLS even with `FORCE`, and the Docker `POSTGRES_USER` is always one. The API connects as `booking_app` (`DATABASE_URL`); only migrations use the owner `booking_admin` (`DATABASE_MIGRATE_URL`).
- **Policy shape.** Every tenant table uses the same policy, with both `USING` and `WITH CHECK` written explicitly:

  ```sql
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
  OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  ```

  `current_setting(..., true)` returns `''` when unset. `NULLIF` turns that into `NULL`, so a missing context yields zero rows instead of a cast error. `tenant_id` is `TEXT`, so there is no `::uuid` cast.
- **The super-admin bypass is a session variable, not `BYPASSRLS`.** It stays visible and auditable in application code. Outside a request, only `AuthService` (identity is resolved before a tenant exists), `prisma/seed.ts` and `BookingsCleanupService` use it, each inside a single transaction so the setting applies to one connection.
- **`tenantId` always comes from the JWT**, never from the request body. `WITH CHECK` would reject a foreign tenant anyway; this is defense in depth.
- **Cross-tenant access returns 404, never 403.** Services contain no `tenantId` comparisons: a row owned by another tenant is invisible to the connection, so it is indistinguishable from a row that does not exist. Existence is never leaked.
- **Denormalized `tenant_id`.** Every tenant table carries its own `tenant_id`, so policies never depend on joins.
- **Request-wide transaction.** Writes spanning several tables (for example `POST /staff` creating a `User`, a `Staff` and its `StaffService` rows) are atomic without an explicit `$transaction`.
- **Slow external calls run after commit.** Every scoped request runs inside an interactive transaction (10 s timeout), so a handler that calls a slow external service (the AI assist LLM call) returns an `AfterCommit` step instead. The interceptor commits, then runs the step with database access disabled: it can only use data read inside the transaction, and the interceptor stays the only place that calls `set_config`.

## Business entities

- **No repository layer.** Services call Prisma directly through `this.prisma.client`; for CRUD of this size an extra layer adds indirection without benefit.
- **A service belongs to exactly one branch.** A tenant-wide catalog shared across branches is a different problem (template vs. instance) and is deferred until it is actually needed.
- **`price` is `Decimal(10,2)`**, never a float.
- **Staff qualifications must match the staff member's branch.** Validated in `StaffService` rather than with a trigger. Invalid `serviceIds`, whether missing, from another branch or from another tenant, return one generic `400`.
- **`PATCH /staff` replaces the full `serviceIds` list** rather than applying incremental adds and removes.
- **`POST /staff` provisions the user too.** There is no invite flow, so it generates a temporary password returned once in the response.
- **Known gap.** Soft-deleting staff does not revoke the user's login; `User` has no active flag yet.

## Schedules and availability

- **Staff schedules and branch opening hours are separate models** (`StaffSchedule`, `BranchSchedule`), each with date-specific exceptions.
- **Wall-clock local time.** Schedules are stored as `@db.Time`/`@db.Date`. A rule like "Monday 9:00" only makes sense locally; a stored UTC offset would shift at every DST change. Conversion to UTC happens only in `AvailabilityService`, with Luxon, against `branch.timezone`, for the specific requested date. Luxon uses the IANA database, so no offsets are computed by hand.
- **`time.util.ts` owns time parsing.** Prisma represents `TIME` as a `Date` anchored at 1970-01-01; the utility converts to and from `HH:mm`. Calendar dates must match `YYYY-MM-DD` and are built with `Date.UTC`, never `new Date(string)`, so an ISO datetime with an offset cannot land on the wrong day.
- **Timezones are validated** with `IANAZone.isValidZone` when a branch is created or updated.
- **Schedule rules.** An exception replaces the weekly rule for that day. `isAvailable`/`isOpen: true` requires times; `false` forbids them. No overnight spans: `endTime` must be after `startTime` on the same day.
- **Overlap checks live in application code.** Editing a schedule is an infrequent admin action, not a concurrency problem, so it does not justify an exclusion constraint.
- **Branch hours are opt-in.** A branch with no `BranchSchedule` rows imposes no restriction. Once any day is configured, unconfigured days are closed. `GET /availability` reports which mode applied through `branchScheduleApplied`.
- **Slot algorithm.**
  1. Resolve staff and service through RLS; `404` if either is invisible.
  2. Require a `StaffService` qualification and a matching branch; otherwise `400`.
  3. Pick the staff blocks for the date (exception or weekly rule) and intersect them with the branch's open blocks.
  4. Convert to UTC and cut slots of `durationMinutes + bufferMinutes`.
  5. Subtract `PENDING` and `CONFIRMED` bookings of that staff member for any service, because the exclusion constraint is per staff member.

## Bookings

- **Double booking is prevented by PostgreSQL.** An `EXCLUDE USING gist` constraint over `tstzrange(start_time, end_time)` per staff member covers `PENDING` and `CONFIRMED`, so a checkout in progress already holds the slot. `start_time`/`end_time` are ordinary `timestamptz` columns because Prisma has no range type.
- **`endTime` is computed on the server** as start + duration + buffer, so cleanup time is blocked by the same constraint.
- **Constraint violations map to `409 Conflict`.** The violation (`23P01`) does not surface as Prisma's `P2004`; it arrives as an unknown request error. `translateDatabaseError` matches on the constraint name and SQLSTATE in the message. A unit test guards this, since no non-concurrent e2e test triggers the constraint.
- **The pre-insert check is not the source of truth.** `POST /bookings` validates the requested start against `AvailabilityService` with `ignoreBookings: true`, turning obviously invalid requests into a clean `400`. Races between concurrent requests are resolved by the constraint. Reads (`GET /availability`) subtract existing bookings; keeping the two modes separate avoids time-of-check/time-of-use flakiness.
- **`PENDING` bookings expire after 10 minutes.** A cron sweep runs every minute (`BookingsCleanupService`). It is the same bulk `UPDATE` every run, so a job queue is unnecessary.
- **Role rules.** `CLIENT` can only list, create and cancel their own bookings. `TENANT_ADMIN` and `STAFF` see all bookings in the tenant and can act on behalf of a client.
- **`GET /bookings` includes display names** (branch, service, staff email) alongside the scalar fields.

## Caching and rate limiting

- **Redis never prevents double booking.** It is a cache-aside layer over the bookings subtracted in `GET /availability`.
- **One cache key per tenant, staff member and day**, shared by every service. `bookingsCacheKey()` is exported so writers invalidate exactly the key readers use.
- **Explicit invalidation** on create, confirm, cancel and the expiry sweep. The 30-second TTL only bounds staleness if an invalidation is missed.
- **Redis failures degrade to cache misses**; they never fail a request.
- **Rate limiting** with `@nestjs/throttler`: 100 requests per minute per IP globally, 5 per minute on `POST /auth/login` and `POST /ai/assist`.
- **Observability.** `CorrelationIdMiddleware` assigns `X-Request-Id`. `AllExceptionsFilter` returns one error shape and logs every error with that id: full stack for 5xx, a one-line warning for 4xx.

## Testing and CI

- **Unit tests cover logic that runs without infrastructure**: `time.util.ts`, the guards and `translateDatabaseError`. CRUD services, RLS, the exclusion constraint and the full availability algorithm need a real Postgres and Redis; mocking them would test the mocks, so they are covered by e2e tests.
- **E2E tests depend on the seed** (`tenant-a`, `tenant-b`, `admin@tenant.dev`, the super admin) instead of per-suite fixtures. Run `npm run seed` first.
- **Tenant isolation is tested at two layers**: over HTTP, and directly against PostgreSQL with session variables set by hand, so a failure points to either the interceptor or the policy.
- **CI jobs**:
  - `lint-and-unit`: no infrastructure required.
  - `e2e`: Postgres and Redis services. It applies `docker/postgres/init.sql`, then `migrate deploy` as `booking_admin`, then seeds and runs the tests as `booking_app`.
  - `web`: lint, type check and Vitest.
  - `docker-build`: builds both production images, without pushing them.

## Frontend

- **Session handling.** Tokens are kept in `localStorage`. `api-client.ts` retries once after a `401` through `/auth/refresh`. The middleware redirects requests without a session cookie; the API remains the authority.
- **Booking wizard.** `/book` runs branch → service → staff → slot → confirm. Going back keeps fetched lists but clears the selections of the step being left. A `409` refreshes availability so the taken slot disappears. Staff filtering by qualification is UX only; the API validates again.
- **`useSearchParams` sits inside `<Suspense>`**; without it, `next build` fails.
- **Long lists** show 8 items, with "show more" and a search box.
- **Alerts center** (`/alerts`).
  - Priority is derived client-side from `GET /bookings` fields by pure functions in `lib/alerts.ts`; there is no severity endpoint.
  - A `CONFIRMED` booking that has ended is `CLOSED`, because nothing in the backend moves it to `COMPLETED`.
  - Demo mode uses time-relative fixtures, because the expiry sweep cancels seeded `PENDING` bookings.
  - The 10-minute TTL is mirrored from the API, and a test fails if the two values diverge.
- **Tailwind.** Never apply two utilities for the same CSS property to one element; state-dependent styles live in a single per-state map.

## Deployment

- **The hosted demo is functionally equivalent to the AWS target, not the same infrastructure.** It runs on Vercel, Render, Neon and Upstash with the same two database roles, migrations and RLS. The AWS layout (Fargate, RDS, ElastiCache, Secrets Manager) is designed but not applied; see [aws-target.md](aws-target.md) and [deploy-demo.md](deploy-demo.md).
- **`NEXT_PUBLIC_*` variables are build-time inputs** of the web image.
- **`seed-demo.ts` is separate from `seed.ts`.** The main seed runs in local Docker and CI. The demo seed is run manually, only against the hosted database, and creates branches in two different timezones on weekdays, so the demo has slots on any weekday.
- **`seed-visual-qa.ts` is for local visual checks only** (30+ branches). Never run it in CI or against the hosted demo.
