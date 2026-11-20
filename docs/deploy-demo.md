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
TRUST_PROXY=1             # proxies in front of the API; see "Rate limiting behind Render's proxy"
OPENAI_API_KEY=…          # optional; without it POST /ai/assist returns 503
```

Migrations never run inside the runtime container. Run them once, as shown above, before the first traffic.

The free tier spins the service down when idle, so the first request after a pause takes 30–50 seconds.

### Rate limiting behind Render's proxy

The API rate-limits per client IP: 5 logins per minute, 100 requests per minute overall. On Render every request reaches the container through Render's proxy, so without configuration the API sees the proxy's address for every user, and the login limit becomes one budget shared by everyone.

- `TRUST_PROXY` is the number of proxies in front of the API. Express then reads the client address from `X-Forwarded-For` that many entries from the right. Unset or `0` means no proxy is trusted, which is right for local Docker.
- Only a whole number is accepted, and the API refuses to start otherwise. `true` would trust every entry in `X-Forwarded-For`, which the client can write itself to dodge the limit.
- Start with `TRUST_PROXY=1`, the usual setting for Express on Render. Render's public docs don't spell out the exact `X-Forwarded-For` chain, so check the value after deploying, as described below.
- `THROTTLE_STORAGE` decides where the counters live. Leave it unset (`memory`) on the demo: it runs one instance and an extra Upstash round-trip per request buys nothing. Set `THROTTLE_STORAGE=redis` whenever more than one API instance serves traffic (for example several ECS tasks behind an ALB), so they share one budget per client. If Redis is unreachable, the API falls back to per-instance counters and logs a warning.

**Check `TRUST_PROXY` after a deploy.** A 429 lasts up to 60 seconds, so wait a minute before steps 1 and 3.

1. Same client, six failed logins. Expect five `401` and then a `429`:

   ```bash
   for i in 1 2 3 4 5 6; do
     curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<api>.onrender.com/auth/login" \
       -H "Content-Type: application/json" \
       -d '{"email":"nobody@example.com","password":"x","tenantSlug":"tenant-a"}'
   done
   ```

2. Straight after step 1, run one failed login from a different network, such as a phone hotspot. Expect `401`. A `429` means the API still sees a proxy address: `TRUST_PROXY` is too low.

3. A minute later, repeat step 1 with a different forged header on each request, for example `-H "X-Forwarded-For: 198.51.100.$i"`. The sixth must still be `429`. Six `401`s mean the API trusts an entry the client wrote: `TRUST_PROXY` is too high.

## 4. Vercel (frontend)

1. Import the same repository with root directory `apps/web`. Vercel builds Next.js natively; `Dockerfile.prod` is only for container platforms.
2. Set `NEXT_PUBLIC_API_URL=https://<api>.onrender.com`. The value is fixed at build time, so redeploy the frontend whenever the API URL changes.
3. After the first deploy, set `CORS_ORIGIN` on Render to the Vercel URL, without a trailing slash, and restart the API.

## Verification

- `GET https://<api>/health` returns `200`.
- Login works for `tenant-a`, `tenant-b` and the super admin.
- A full booking (branch → service → staff → slot) returns `201` in the UI.
