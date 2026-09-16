# Booking SaaS

Multi-tenant appointment booking: **NestJS** API and **Next.js** web app. PostgreSQL **Row Level Security** keeps tenants isolated. Availability uses the branch timezone (Luxon). Overlapping bookings are rejected by a database exclusion constraint.

## Demo

**Web:** https://booking-saas-web-two.vercel.app/login  
**API:** https://booking-saas-wrac.onrender.com/health

The first request after idle can take ~30–50 seconds (hosted API spins down). Retry once if login fails.

Password for all accounts: `ChangeMe123!`

| Role | Email | Login → Tenant |
|------|--------|----------------|
| Clinic | `admin@tenant.dev` | Tenant A — Demo Clínica |
| Salon | `admin@tenant.dev` | Tenant B — Demo Salón |
| Platform admin | `admin@bookingsaas.dev` | Super admin |

Walkthrough: Tenant A → **Sucursal Centro** → New booking → service, staff, weekday slot → confirm. Tenant B has a different catalog and timezone (`America/Mexico_City`).

## Stack

NestJS · Prisma · PostgreSQL 16 (RLS, `booking_admin` / `booking_app`) · Redis · Next.js 14 · GitHub Actions (lint, unit, e2e, production images)

## Run locally

```bash
cp .env.example .env
docker compose up --build
```

Web: http://localhost:3000 · API: http://localhost:3001/health

## Repository

```
apps/api    NestJS
apps/web    Next.js
docker/     Postgres init (btree_gist, app role)
docs/       Design notes (optional reading)
```

Production Dockerfiles: `apps/api/Dockerfile.prod`, `apps/web/Dockerfile.prod`.  
Intended AWS layout (not deployed): [docs/aws-target.md](docs/aws-target.md).  
Phase-by-phase engineering notes: [docs/engineering-log.md](docs/engineering-log.md).
