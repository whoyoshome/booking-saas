# Hosted demo deployment

Runbook for the public demo. It uses managed free tiers that are functionally equivalent to the [AWS target](aws-target.md), with the same database roles, migrations and RLS. It is not AWS.

| Component | Service | Configuration |
|-----------|---------|---------------|
| Frontend | Vercel | Next.js project, root directory `apps/web` |
| API | Render | `apps/api/Dockerfile.prod` |
| PostgreSQL | Neon | Same roles as `init.sql`, then `prisma migrate deploy` |
| Redis | Upstash | TLS URL (`rediss://…`) |

## 1. Neon (PostgreSQL)

1. Create a Postgres project.
2. With the Neon admin user, apply the logic of `docker/postgres/init.sql`: a non-superuser runtime role equivalent to `booking_app`, the `btree_gist` extension, grants and `ALTER DEFAULT PRIVILEGES`.
3. Keep two connection strings:
   - admin, for migrations: `DATABASE_MIGRATE_URL`;
   - runtime role, subject to RLS: `DATABASE_URL`.
4. Run the migrations and seeds from a machine with the repository:

```bash
cd apps/api
DATABASE_URL="$DATABASE_MIGRATE_URL" npx prisma migrate deploy
npm run seed        # uses DATABASE_URL (runtime role)
npm run seed:demo   # demo branches, services and staff; hosted demo only
```

Then smoke-test a login and a booking in each of the two tenants.

## 2. Upstash (Redis)

Create a Redis database and set its TLS URL as `REDIS_URL`.

## 3. Render (API)

1. Create a Web Service from the GitHub repository.
2. Set the root directory to `apps/api` and the Dockerfile path to `Dockerfile.prod`.
3. Set the health check path to `/health`.
4. Set the environment variables:

```
NODE_ENV=production
PORT=3001
DATABASE_URL=…            # runtime role, subject to RLS
REDIS_URL=…               # Upstash
JWT_SECRET=…
JWT_REFRESH_SECRET=…
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://<app>.vercel.app
OPENAI_API_KEY=…          # optional; without it POST /ai/assist returns 503
```

Migrations never run inside the runtime container. Run them once, as shown above, before the first traffic.

The free tier spins the service down when idle, so the first request after a pause takes 30–50 seconds.

## 4. Vercel (frontend)

1. Import the same repository with root directory `apps/web`. Vercel builds Next.js natively; `Dockerfile.prod` is only for container platforms.
2. Set `NEXT_PUBLIC_API_URL=https://<api>.onrender.com`. The value is fixed at build time, so redeploy the frontend whenever the API URL changes.
3. After the first deploy, set `CORS_ORIGIN` on Render to the Vercel URL, without a trailing slash, and restart the API.

## Verification

- `GET https://<api>/health` returns `200`.
- Login works for `tenant-a`, `tenant-b` and the super admin.
- A full booking (branch → service → staff → slot) returns `201` in the UI.
