# Track 11-B — Demo live (gratis) para portfolio

Objetivo: un reclutador abre un link, inicia sesión y hace una reserva.
**No es AWS.** Es un stack managed free equivalente en función.

| Pieza | Servicio free | Cómo se usa aquí |
|-------|---------------|------------------|
| Frontend | **Vercel** | Proyecto Next.js; Root Directory = `apps/web` |
| API | **Render** (o Fly.io) | Dockerfile = `apps/api/Dockerfile.prod` |
| Postgres | **Neon** | Mismos roles/`init.sql` + `prisma migrate deploy` |
| Redis | **Upstash** | `REDIS_URL` con TLS (`rediss://…`) |

## Orden recomendado

### 1. Neon (Postgres)

1. Crear proyecto Postgres.
2. Crear rol runtime no-superuser (equivalente a `booking_app`) y aplicar la lógica de `docker/postgres/init.sql` (extensión `btree_gist`, grants, `ALTER DEFAULT PRIVILEGES`) con el usuario admin de Neon.
3. Connection strings:
   - Admin/migrate → `DATABASE_MIGRATE_URL`
   - App runtime → `DATABASE_URL` (rol sujeto a RLS)
4. Desde una máquina con el repo (o un one-off job):

```bash
cd apps/api
DATABASE_URL="$DATABASE_MIGRATE_URL" npx prisma migrate deploy
DATABASE_URL="$DATABASE_URL" npm run seed
```

Validar que RLS sigue activo (los e2e locales ya lo prueban; en Neon conviene un smoke login + booking entre dos tenants).

### 2. Upstash (Redis)

1. Crear base Redis.
2. Copiar la URL TLS a `REDIS_URL` (suele ser `rediss://…`).

### 3. Render (API)

1. New → Web Service → conectar el repo GitHub.
2. **Root Directory:** `apps/api` (o Dockerfile path relativo al repo).
3. **Dockerfile path:** `Dockerfile.prod` (si root = `apps/api`) o `apps/api/Dockerfile.prod`.
4. Health check path: `/health`.
5. Env vars mínimas:

```
NODE_ENV=production
PORT=3001
DATABASE_URL=…          # booking_app / RLS
REDIS_URL=…             # Upstash
JWT_SECRET=…
JWT_REFRESH_SECRET=…
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://<tu-app>.vercel.app
SEED_SUPER_ADMIN_EMAIL=…   # solo si corres seed en este entorno
SEED_SUPER_ADMIN_PASSWORD=…
```

**Nota Render free:** el servicio puede “dormir”; el primer request tarda. Documentarlo en el README del portfolio.

Migraciones: **no** van dentro del contenedor de runtime. Correrlas una vez (CLI local o job one-off) con `DATABASE_MIGRATE_URL` antes del primer tráfico.

### 4. Vercel (Web)

1. Importar el mismo repo.
2. **Root Directory:** `apps/web`.
3. Framework: Next.js (Vercel no necesita `Dockerfile.prod`; el Docker es para Render/ECS).
4. Env:

```
NEXT_PUBLIC_API_URL=https://<tu-api>.onrender.com
```

`NEXT_PUBLIC_*` se fija en **build**; si cambia la URL de la API, hay que **redeploy** el frontend.

5. Tras el deploy, actualizar `CORS_ORIGIN` en Render con la URL real de Vercel y reiniciar la API.

## Checklist demo

- [ ] `GET https://<api>/health` → 200
- [ ] Login con usuario seed / tenant demo
- [ ] Flujo reserva visible en UI
- [ ] README del repo con ambos links + nota “demo free ≠ AWS”
- [ ] Credenciales demo (o instrucciones) para el reclutador

## Honestidad (texto sugerido para el README raíz)

```markdown
## Live demo (portfolio)

- Web: https://….vercel.app
- API: https://….onrender.com/health

Stack: Vercel + Render + Neon + Upstash (free tiers).
Target production: AWS Fargate + RDS + ElastiCache — see docs/aws-target.md (not deployed; no AWS account yet).
```
