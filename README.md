# Booking SaaS

Multi-tenant booking platform (NestJS API + Next.js). Row Level Security in Postgres so **tenant A never sees tenant B**. Timezones with Luxon, Redis cache, CI on every push.

---

## Live demo

| | URL |
|--|--|
| **App** | https://booking-saas-web-two.vercel.app/login |
| **API health** | https://booking-saas-wrac.onrender.com/health |

The API is on Render **free**: the first request after idle can take **30–50s**. Retry login if it times out — that is the host sleeping, not a bug.

### Test accounts (same password: `ChangeMe123!`)

| Who | Email | Tenant in the login select |
|--|--|--|
| Clinic admin | `admin@tenant.dev` | Tenant A — Demo Clínica |
| Salon admin | `admin@tenant.dev` | Tenant B — Demo Salón |
| Super admin | `admin@bookingsaas.dev` | Super admin (sin tenant) |

**Try this:** log in as Tenant A → pick **Sucursal Centro** → **Nueva reserva** → service / staff / a weekday slot → confirm. Log in as Tenant B: different branch, timezone (`America/Mexico_City`), and catalog. That is the product.

This live stack is **Vercel + Render + Neon + Upstash** (free tiers). It is **not AWS**. Production target (Fargate, RDS, ElastiCache) is documented and **not deployed**: [`docs/aws-target.md`](docs/aws-target.md). Deploy notes: [`docs/deploy-demo.md`](docs/deploy-demo.md).

---

## Stack

| Layer | Tech |
|--|--|
| API | NestJS, Prisma, JWT (access + rotating refresh), argon2id |
| Web | Next.js 14 (App Router), Tailwind |
| Data | PostgreSQL 16, **RLS** + roles `booking_admin` / `booking_app`, `btree_gist` exclusion on overlapping bookings |
| Cache | Redis (ioredis; degrades if Redis is down) |
| CI | GitHub Actions: lint, unit, e2e (59), production Docker builds |

## What a reviewer usually asks

- **Isolation:** RLS + `SET LOCAL` per request, not `WHERE tenant_id` only in the app.
- **Correct time:** availability in the **branch** IANA timezone, not the server’s.
- **Double booking:** Postgres exclusion constraint, mapped to HTTP 409.
- **Honest deploy:** Dockerfiles of production exist; AWS is a written target, not a fake “runs on ECS” claim.

---

## Local (Docker)

```bash
cp .env.example .env
docker compose up --build
```

API `http://localhost:3001/health` · web `http://localhost:3000`.  
After `docker compose down -v`, migrate as `booking_admin` then `npm run seed` (see Fase 1 below).

---

## Docs vs this file

| File | For |
|--|--|
| **This README** | Demo, stack, then the **engineering log** (Fases 1–12) |
| [`docs/deploy-demo.md`](docs/deploy-demo.md) | How the free demo was wired (Neon roles, Render, Vercel) |
| [`docs/aws-target.md`](docs/aws-target.md) | Intended AWS shape — not applied |

You do **not** need another markdown for a recruiter. The log below is for depth; the tables above are enough to start.

---

# Engineering log (phases)

The rest of this file is a chronological bitácora (setup → auth → RLS → bookings → CI → demo → UX). Skip it unless you want design decisions and checklists.

---



## Estructura

```
booking-saas/
  apps/
    api/      # NestJS (backend)
    web/      # Next.js (frontend)
  docker/
    postgres/
      init.sql   # habilita btree_gist
  docker-compose.yml
  .env.example
```

Monorepo con **npm workspaces** (simple, sin herramientas adicionales como
Turborepo/Nx todavía — las agregaríamos si el build cross-package se vuelve
lento o necesitamos cachear tareas entre apps, ninguna de las dos cosas es
cierta con 2 apps).

## Paso a paso

### 1. Variables de entorno

```bash
cp .env.example .env
```

Revisa `.env` — para desarrollo local los valores por defecto sirven tal
cual. **Nunca** commitees `.env` (ya está en `.gitignore`).

### 2. Levantar todo

```bash
docker-compose up --build
```

La primera vez tarda más (instala dependencias de npm dentro de cada
contenedor). Vas a ver los logs de los 4 servicios intercalados:
`booking-postgres`, `booking-redis`, `booking-api`, `booking-web`.

### 3. Verificar que cada pieza levantó correctamente

| Servicio | Cómo verificar | Resultado esperado |
|---|---|---|
| PostgreSQL | `docker exec -it booking-postgres psql -U booking_admin -d booking_saas -c "\dx"` | La extensión `btree_gist` aparece en la lista |
| Redis | `docker exec -it booking-redis redis-cli ping` | `PONG` |
| API | `curl http://localhost:3001/health` | `{"status":"ok","service":"api",...}` |
| Web | Abrir `http://localhost:3000` en el navegador | Página "Booking SaaS — Fase 1" mostrando el JSON de `/health` (confirma que `web` habla con `api` **dentro** de la red Docker) |

Si `http://localhost:3000` muestra el mensaje rojo de error de conexión,
el problema casi siempre es orden de arranque — revisa que `depends_on`
con `condition: service_healthy` esté funcionando: `docker-compose ps`
debe mostrar `postgres` y `redis` como `healthy` antes de que `api` entre
en estado `running`.

### 4. Apagar

```bash
docker-compose down          # detiene y borra contenedores, conserva el volumen de datos
docker-compose down -v       # además borra el volumen de PostgreSQL (reset total)
```

## Criterios de Fase 1 (Definition of Done)

- [x] `docker-compose up --build` levanta los 4 servicios sin errores.
- [x] `GET /health` responde 200 desde fuera del contenedor (`localhost:3001`).
- [x] `GET /health` responde 200 desde **dentro** de la red Docker (verificado vía la home de Next.js, que llama a `http://api:3001`, no a `localhost`).
- [x] `btree_gist` está habilitada en la base de datos (queda lista para el exclusion constraint de la Fase 6).
- [x] Cambios en `apps/api/src/**` o `apps/web/app/**` se reflejan con hot-reload sin reconstruir la imagen (verificado por los bind mounts en `docker-compose.yml`).
- [x] `.env` no está en el repositorio; `.env.example` sí.

## Notas de diseño de este setup

- **Bind mounts + volumen anónimo para `node_modules`**: montamos el código fuente como volumen para hot-reload, pero excluimos `node_modules` con un volumen anónimo (`/app/node_modules`) para que no se sobreescriba con el `node_modules` de tu máquina host (que puede tener binarios compilados para otro SO/arquitectura — causa clásica de "funciona en mi Mac pero no en el contenedor Linux").
- **`healthcheck` + `depends_on: condition: service_healthy`**: sin esto, `depends_on` en Docker Compose solo garantiza *orden de arranque del proceso*, no que Postgres ya acepte conexiones. La API podría arrancar antes de que Postgres esté realmente listo — la garantía de `service_healthy` evita esa race condition en el propio orquestador de desarrollo.
- **`web` llama a `api` por nombre de servicio (`http://api:3001`), no `localhost`**: dentro de la red interna de Docker Compose, cada servicio es resoluble por su nombre. Esto es intencional y es exactamente cómo se comunicarán los contenedores en ECS más adelante (vía service discovery/load balancer interno) — así evitamos que el código development-only diverja del patrón que usaremos en producción.
- Los `Dockerfile` actuales son de **desarrollo únicamente** (instalan devDependencies, corren en modo watch). Las imágenes de producción (multi-stage, build compilado, sin herramientas de dev) las diseñamos en la Fase 10 junto con ECR/ECS — no antes, porque hacerlo ahora sería optimizar algo que todavía va a cambiar.

---

# Fase 2: Autenticación

## Qué se agregó

- **Prisma** conectado a PostgreSQL, con un modelo `User` mínimo (`role`,
  `tenantId` nullable, `passwordHash`, `refreshTokenHash`).
- **Hashing de contraseñas con argon2id.**
- **JWT de dos tokens:** access token (15 min) + refresh token (7 días),
  firmados con secrets distintos.
- **Rotación de refresh token** con detección de reuso (si alguien intenta
  reusar un refresh token ya rotado, se revoca la sesión completa).
- **RBAC** vía `JwtAuthGuard` + `RolesGuard` + `@Roles()`.
- Un script de **seed** que crea el primer `SUPER_ADMIN` (no hay endpoint
  público de registro — ver el comentario en `prisma/seed.ts` sobre el
  problema de bootstrapping).

## Paso a paso

### 1. Instalar dependencias nuevas y generar el cliente de Prisma

Como cambiamos `package.json`, reconstruye la imagen de `api`:

```bash
docker-compose up --build api
```

(`postinstall` corre `prisma generate` automáticamente).

### 2. Crear la migración inicial

```bash
docker exec -it booking-api npx prisma migrate dev --name init
```

Esto crea la tabla `users` en PostgreSQL y el historial de migraciones en
`apps/api/prisma/migrations/`. **Este directorio sí se commitea** (a
diferencia de `node_modules` o `.env`) — las migraciones son parte del
código, no un artefacto generado descartable.

### 3. Crear el super admin de prueba

```bash
docker exec -it booking-api npm run seed
```

Deberías ver `Super admin creado: admin@bookingsaas.dev / ChangeMe123!`
(o los valores que hayas puesto en `SEED_SUPER_ADMIN_EMAIL` /
`SEED_SUPER_ADMIN_PASSWORD` en tu `.env`).

### 4. Probar el flujo completo

```bash
# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bookingsaas.dev","password":"ChangeMe123!"}'
```

Copia el `accessToken` de la respuesta y pruébalo:

```bash
# Ruta protegida solo por autenticación
curl http://localhost:3001/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# Ruta protegida por autenticación + rol (SUPER_ADMIN pasa, CLIENT no)
curl http://localhost:3001/auth/admin-only \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Prueba el refresh con el `refreshToken` de la respuesta del login:

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

Y confirma que **reusar el mismo refresh token una segunda vez falla**
(esa es la prueba real de que la rotación funciona):

```bash
# Repetir el mismo curl de refresh con el MISMO refreshToken original
# → debe responder 401, no un nuevo par de tokens
```

## Criterios de Fase 2 (Definition of Done)

- [x] La migración `init` corre sin errores y crea la tabla `users`.
- [x] El seed crea el super admin sin duplicarlo si se corre dos veces.
- [x] `POST /auth/login` con credenciales correctas devuelve `accessToken` + `refreshToken`.
- [x] `POST /auth/login` con contraseña incorrecta devuelve 401 con el **mismo mensaje** que un email inexistente (sin fuga de información).
- [x] `GET /auth/me` sin token devuelve 401; con token válido devuelve el usuario.
- [x] `GET /auth/admin-only` con un token de rol no autorizado devuelve 403 (vas a poder probar esto de verdad recién en Fase 4, cuando existan usuarios con otros roles — por ahora solo confirma que un token inválido/ausente da 401).
- [x] Reusar un `refreshToken` ya rotado devuelve 401 (prueba de la mitigación de robo de token).
- [x] `POST /auth/logout` invalida la sesión: un `refresh` posterior con ese token falla.

## Notas de diseño de esta fase

- **Por qué dos secrets JWT distintos** (`JWT_SECRET` vs `JWT_REFRESH_SECRET`): si un access token se filtra (vida corta, 15 min, más expuesto por viajar en cada request), el atacante no puede usarlo para forjar un refresh token válido, porque están firmados con claves distintas. Es defensa en profundidad barata.
- **Por qué el refresh token se compara contra un hash, no en texto plano:** si la tabla `users` se filtra (ej. un dump de base de datos mal expuesto), un atacante con los hashes no puede reconstruir refresh tokens utilizables — tendría que romper argon2id, lo mismo que con las contraseñas.
- **Limitación conocida y deliberada:** una sola sesión activa por usuario (ver el comentario al inicio de `auth.service.ts`). Documentado ahí el porqué y cuándo evolucionarlo.
- **Lo que NO se hizo en esta fase, a propósito:** aislamiento multi-tenant real (RLS, `SET LOCAL app.current_tenant_id`) — eso es exactamente el alcance de la Fase 3. Ahora mismo `tenantId` viaja en el JWT y está disponible en `request.user`, pero ningún guard todavía lo usa para filtrar datos, porque no hay datos de otros tenants que filtrar todavía.

## Siguiente paso

Cuando confirmes los checkboxes de arriba, avanzamos a **Fase 3 —
Multi-tenancy** (modelo `Tenant`, `TenantGuard`, RLS y los tests de
aislamiento entre tenants).

---

# Fase 3: Multi-tenancy — Bitácora

Plan completo de 7 pasos (acordado antes de empezar a programar):

1. Modelo `Tenant` + migración + FK real en `User`. **✅ Completado.**
2. `AuthService.login` con resolución real por `tenantSlug` + unique compuesto. **✅ Completado (este documento).**
3. `TenantGuard`. **✅ Completado.**
4. `AsyncLocalStorage` + `TenantContextInterceptor` + ajuste de `PrismaService` para `SET LOCAL`. **✅ Completado (este documento).**
5. Migración SQL cruda: habilitar RLS + policy en Postgres. **✅ Completado (este documento).**
6. Seed con segundo tenant de prueba. **✅ Completado como parte del Paso 1** (se adelantó porque era necesario para poder probar el unique compuesto de inmediato).
7. Tests de integración de aislamiento entre tenants. **✅ Completado (este documento) — cierra la Fase 3.**

## Paso 1 — Modelo Tenant + migración + FK (cerrado)

**Qué se hizo:**
- Modelo `Tenant` (`id`, `name`, `slug` único, `timezone`, `status`).
- `User.tenantId` pasó de campo suelto a FK real (`tenant Tenant? @relation(...)`).
- `email` dejó de ser único global; ahora es único compuesto `(tenantId, email)` vía la constraint nombrada `tenant_email_unique`.
- Seed actualizado: además del `SUPER_ADMIN`, crea `tenant-a` y `tenant-b`, cada uno con un `TENANT_ADMIN` en `admin@tenant.dev` — mismo email, tenants distintos, a propósito (ejercita el unique compuesto).

**Nota de diseño — edge case aceptado:** en PostgreSQL, un `UNIQUE` compuesto trata cada `NULL` como distinto entre sí. Como `tenantId` es `NULL` para todo `SUPER_ADMIN`, la constraint no impide dos super admins con el mismo email. Riesgo bajo (los super admins solo se crean vía seed/script administrativo) — no se resuelve con una constraint adicional en esta fase.

**Verificado con 5 checks directos en PostgreSQL** (tabla `tenants` existe, FK en `users`, índice `tenant_email_unique` compuesto — no solo sobre `email` —, 2 tenants insertados, 3 usuarios con el `tenant_id` esperado en cada fila).

## Paso 2 — Login con resolución real de tenantSlug (cerrado en este mensaje)

**El problema que resuelve:** desde la Fase 2, `AuthService.login` buscaba por `email` de forma global (`findFirst`), documentado explícitamente como estado intermedio. Con el modelo `Tenant` ya migrado, ese `findFirst` deja de tener sentido — ahora el sistema puede (y debe) resolver el tenant antes de buscar al usuario.

**Diseño:**

- `LoginDto` gana un campo opcional `tenantSlug`.
- Si `tenantSlug` **no** viene: se busca un usuario con `tenantId: null` — solo puede matchear un `SUPER_ADMIN`.
- Si `tenantSlug` **sí** viene: se resuelve el `Tenant` por `slug`, y la búsqueda de usuario queda acotada a `tenant_email_unique: { tenantId: tenant.id, email }` — un único lookup indexado, ya no un scan global.
- **Mismo mensaje de error genérico** (`Credenciales inválidas`) en los 4 casos de fallo: contraseña incorrecta, email inexistente, `tenantSlug` inexistente, o tenant con `status: SUSPENDED`. Distinguir cualquiera de estos casos permitiría enumerar qué `slugs` de tenant existen o qué tenants están suspendidos — la misma clase de fuga de información que ya evitamos con el email en la Fase 2.
- El caso de tenant inexistente/suspendido también corre el hash "dummy" de mitigación de timing attack, igual que el caso de usuario no encontrado.

**Archivos modificados:**
- `apps/api/src/auth/dto/login.dto.ts` — campo `tenantSlug` opcional.
- `apps/api/src/auth/auth.service.ts` — `login()` ahora resuelve el tenant antes de buscar al usuario, vía `findUnique` sobre el constraint compuesto (reemplaza el `findFirst` temporal).
- `apps/api/src/auth/auth.controller.ts` — pasa `dto.tenantSlug` al service.

**Qué NO cambia en este paso:** `TenantGuard`, RLS, y el filtrado de datos por tenant en requests autenticadas siguen sin existir — eso es exactamente el alcance de los Pasos 3 a 5. Después de este paso, el JWT lleva el `tenantId` correcto porque el login lo resolvió bien, pero ningún guard todavía impide que, en teoría, una query mal escrita cruce tenants. Esa garantía llega en los próximos pasos.

### Comandos de prueba

No hay migración nueva en este paso — es lógica de aplicación pura, no cambia el schema. Solo hace falta reconstruir la imagen de `api` porque cambió código fuente:

```bash
docker-compose up --build api
```

**1. Login de un tenant admin, con tenantSlug correcto — debe funcionar:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-a"}'
```

Debe devolver `accessToken` + `refreshToken`. Decodifica el `accessToken` (jwt.io o similar) y confirma que el `tenantId` del payload corresponde al `id` de `tenant-a` en tu base de datos (compáralo con el `SELECT id, slug FROM tenants;` que corriste en el Paso 1).

**2. Mismo email, tenant distinto — debe devolver un token con OTRO tenantId:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-b"}'
```

Esta es la prueba real de que el unique compuesto y la resolución por slug funcionan juntos: mismo `email`, pero el `tenantId` del payload debe ser el de `tenant-b`, no el de `tenant-a`.

**3. tenantSlug inexistente — debe fallar con 401 genérico:**

```bash
curl -i -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-que-no-existe"}'
```

Debe responder `401` con el mismo mensaje `"Credenciales inválidas."` que verías con una contraseña incorrecta — no un 404 ni un mensaje distinto.

**4. Email correcto pero tenantSlug de OTRO tenant al que no pertenece — debe fallar:**

```bash
curl -i -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bookingsaas.dev","password":"ChangeMe123!","tenantSlug":"tenant-a"}'
```

`admin@bookingsaas.dev` es el `SUPER_ADMIN` (`tenantId: null`), así que pedir login con un `tenantSlug` debe fallar — el `SUPER_ADMIN` no existe dentro de `tenant-a`. Mismo 401 genérico.

**5. Super admin sin tenantSlug — sigue funcionando igual que en Fase 2:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bookingsaas.dev","password":"ChangeMe123!"}'
```

### Checklist del Paso 2

- [x] Login con `tenantSlug: "tenant-a"` funciona y el JWT decodificado trae el `tenantId` de `tenant-a`.
- [x] Login con el mismo email pero `tenantSlug: "tenant-b"` funciona y trae el `tenantId` de `tenant-b` (confirma que el unique compuesto realmente desambigua).
- [x] `tenantSlug` inexistente → 401 genérico, no 404.
- [x] Super admin con un `tenantSlug` cualquiera → 401 (no existe en ningún tenant).
- [x] Super admin sin `tenantSlug` → sigue funcionando como en Fase 2.

**Verificado en Postman:** login de `SUPER_ADMIN`, login de tenant admin con `tenantSlug` válido, y rechazo con `tenantSlug` incorrecto — los 3 casos pasaron.

### Fix aplicado durante la verificación — error de tipos TS2322

**Síntoma:** `findUnique({ where: { tenant_email_unique: { tenantId, email } } })` no compilaba cuando `tenantId` podía ser `null`.

**Causa:** el tipo de input que Prisma genera para un campo `@unique` compuesto no acepta `null` explícito en uno de sus componentes en TypeScript, aunque PostgreSQL sí maneja `NULL` correctamente en el índice subyacente. Es una limitación de los tipos generados, no del motor de base de datos.

**Fix:** en vez de forzar el tipo, se separó la lógica en dos ramas explícitas:

```ts
const user = tenantId
  ? await this.prisma.user.findUnique({
      where: { tenant_email_unique: { tenantId, email } },
    })
  : await this.prisma.user.findFirst({
      where: { tenantId: null, email },
    });
```

- Con `tenantId` resuelto (login de tenant): `findUnique` sobre la constraint compuesta real — un solo lookup indexado.
- Sin `tenantId` (`SUPER_ADMIN`): `findFirst` sobre `{ tenantId: null, email }` — funcionalmente equivalente (en la práctica solo puede haber una fila, dado el edge case de `NULL` ya documentado en el Paso 1), pero sin pelear contra el tipo generado.

No cambia ninguna garantía de seguridad ni de comportamiento — es puramente un ajuste para que TypeScript compile con el tipo real que Prisma expone.

## Paso 3 — TenantGuard

**Qué resuelve:** hasta ahora, `tenantId` viaja en el JWT y está disponible en `request.user`, pero ningún guard lo usa todavía. `TenantGuard` es la puerta de entrada explícita: garantiza que cualquier usuario que no sea `SUPER_ADMIN` tenga un `tenantId` válido antes de llegar al handler de la ruta.

**Lo que este guard NO hace (a propósito):** no filtra datos por tenant. Eso sigue siendo trabajo de RLS + `SET LOCAL`, que llega en los Pasos 4 y 5. `TenantGuard` responde una sola pregunta: *"¿este usuario tiene un contexto de tenant válido para estar aquí?"* — no *"¿qué filas puede ver?"*.

**Regla:**
- `SUPER_ADMIN` → pasa siempre (no pertenece a ningún tenant, por diseño).
- Cualquier otro rol sin `tenantId` en el JWT → `403 Forbidden`. En la práctica esto no debería ocurrir nunca si el login funciona bien (todo usuario no-super-admin se loguea con un `tenantSlug` y por lo tanto un `tenantId`), así que este guard es una **red de seguridad defensiva**, no el mecanismo principal de nada — similar en espíritu a por qué agregamos RLS en el Paso 5 en vez de confiar solo en el filtro de aplicación.

**Archivos:**
- `apps/api/src/auth/guards/tenant.guard.ts` — nuevo.
- `apps/api/src/auth/auth.controller.ts` — nuevo endpoint de demostración `GET /auth/tenant-context`, protegido por `JwtAuthGuard + TenantGuard`.

### Comandos de prueba

```bash
docker-compose up --build api
```

**1. Tenant admin con JWT válido — debe pasar:**

```bash
# Primero logueate como admin de tenant-a y copia el accessToken
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-a"}'

curl http://localhost:3001/auth/tenant-context \
  -H "Authorization: Bearer <ACCESS_TOKEN_DE_TENANT_A>"
```

Debe devolver 200 con el `tenantId` de `tenant-a`.

**2. Super admin — debe pasar también (bypass explícito):**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bookingsaas.dev","password":"ChangeMe123!"}'

curl http://localhost:3001/auth/tenant-context \
  -H "Authorization: Bearer <ACCESS_TOKEN_DE_SUPER_ADMIN>"
```

Debe devolver 200, con `tenantId: null` en el body (el super admin no tiene tenant, pero el guard lo deja pasar).

**3. Sin token — debe fallar antes de llegar a TenantGuard:**

```bash
curl -i http://localhost:3001/auth/tenant-context
```

Debe devolver `401` (lo bloquea `JwtAuthGuard`, ni siquiera llega a `TenantGuard`).

### Checklist del Paso 3

- [x] Tenant admin autenticado con `tenantId` válido → 200 en `/auth/tenant-context`.
- [x] Super admin autenticado (sin tenant) → 200 también, bypass confirmado.
- [x] Request sin token → 401.
- [x] (Este caso no se puede probar de verdad hasta que exista un JWT sin `tenantId` para un rol no-super-admin, lo cual no debería ser posible con el login actual — anotarlo como "no aplicable todavía" y no como pendiente real.)

**Verificado:** `GET /auth/tenant-context` con token de `TENANT_ADMIN` de `tenant-a` → 200 y `tenantId` coincide con la BD; con token de `SUPER_ADMIN` → 200 y `tenantId: null`; sin token → 401.

Cuando confirmes estos 3 puntos, seguimos con el **Paso 4: `AsyncLocalStorage` + `TenantContextInterceptor` + `SET LOCAL`** — ahí es donde el `tenantId` empieza a tener efecto real sobre qué filas devuelve PostgreSQL.

## Paso 4 — AsyncLocalStorage + TenantContextInterceptor + SET LOCAL

**El problema que resuelve:** desde el Paso 3, `tenantId` vive en el JWT y `TenantGuard` valida que sea coherente, pero **ninguna query a PostgreSQL sabe nada de eso todavía**. Este paso es el mecanismo que conecta ambos mundos: por cada request autenticada, abre una transacción real de PostgreSQL, le informa "esta conexión pertenece al tenant X" vía una variable de sesión, y dejar correr el resto del handler (controller → service → repository) dentro de esa transacción — sin que el código de los repositorios tenga que saber nada de esto.

### Componentes nuevos

- **`TenantContextStorage`** (`prisma/tenant-context.storage.ts`) — wrapper tipado sobre `AsyncLocalStorage` de Node. Guarda una referencia al cliente Prisma *transaccional* activo durante el ciclo de vida de una request, sin pasarlo como parámetro por cada capa.
- **`TenantContextInterceptor`** (`prisma/tenant-context.interceptor.ts`) — abre `prisma.$transaction(async (tx) => {...})`, ejecuta `SELECT set_config('app.current_tenant_id', '<uuid>', true)` (o `app.is_super_admin` para `SUPER_ADMIN`), guarda `tx` en el `AsyncLocalStorage`, y deja correr el resto del pipeline (`next.handle()`) dentro de ese callback.
- **`PrismaService.client`** (getter nuevo) — devuelve el cliente transaccional del `AsyncLocalStorage` si existe, o el cliente normal si no (rutas sin autenticar, seeds, bootstrap). Los repositorios futuros deben usar `this.prisma.client.xxx`, nunca `this.prisma.xxx` directo, una vez que toquen tablas con RLS (Paso 5).

### Decisiones de diseño que quiero que quede explícitas

**Por qué `set_config(..., true)` y no `SET LOCAL` como texto SQL crudo:** `SET LOCAL` no admite parámetros bindeados — es una sentencia SQL, no una llamada a función. `set_config(setting_name, value, is_local)` sí es una función normal, así que Prisma puede parametrizarla igual que cualquier otro query (`${user.tenantId}` en el template tag), evitando concatenar el valor a mano. El comportamiento (`true` en el tercer argumento) es idéntico a `SET LOCAL`: el valor solo vive dentro de la transacción actual.

**Por qué el interceptor se aplica explícitamente por ruta y no de forma global:** mismo criterio que con los guards desde la Fase 2 — preferimos rutas protegidas de forma explícita antes que un mecanismo global con una lista de excepciones. El costo es que cada controller de dominio futuro (branches, bookings) tiene que acordarse de agregarlo. Cuando tengamos más de 2-3 controllers tocando tablas con RLS, vale la pena crear un decorador compuesto (`@TenantScoped()` = guards + interceptor juntos) — no antes, sería complejidad sin un problema real todavía.

**Trade-off de rendimiento, aceptado desde el diseño original de la Fase 3:** cada request autenticada bajo este interceptor corre dentro de una transacción interactiva de Prisma, con timeout configurado a 10s (el default es 5s). **Advertencia para fases futuras:** este mecanismo NO debe combinarse con llamadas externas lentas — el asistente de IA (Fase 12) llama a Claude/OpenAI, que puede tardar varios segundos; esa ruta no debe usar este interceptor, o debe sacar la llamada lenta fuera de la transacción. Lo dejo anotado aquí para no olvidarlo cuando lleguemos a esa fase.

**Por qué el bypass de `SUPER_ADMIN` es una variable de sesión explícita (`app.is_super_admin`) y no un rol de Postgres con `BYPASSRLS`:** ya lo habíamos decidido en el plan original de la Fase 3 — queremos que el bypass sea visible en el código de la aplicación (este interceptor) y auditable, no un privilegio invisible a nivel de conexión de base de datos.

### Endpoint de diagnóstico (temporal)

`GET /auth/db-tenant-check` — existe solo para probar el mecanismo de punta a punta antes de que exista una tabla real con RLS. Ejecuta `current_setting('app.current_tenant_id', true)` dentro de la misma transacción que abrió el interceptor, y lo devuelve junto al `tenantId` del JWT para compararlos. **Se elimina** cuando exista el primer módulo de dominio real con RLS (branches, en la Fase 4 general del roadmap) — inyectar `PrismaService` directo en un controller no es el patrón que queremos mantener, es aceptable solo porque esta ruta existe para inspeccionar la conexión misma, no para implementar un caso de uso real.

**Archivos nuevos:**
- `apps/api/src/prisma/tenant-context.storage.ts`
- `apps/api/src/prisma/tenant-context.interceptor.ts`

**Archivos modificados:**
- `apps/api/src/prisma/prisma.service.ts` — constructor con `TenantContextStorage` inyectado + getter `client`.
- `apps/api/src/prisma/prisma.module.ts` — registra y exporta los 2 providers nuevos.
- `apps/api/src/auth/auth.controller.ts` — endpoint diagnóstico `GET /auth/db-tenant-check`.

### Comandos de prueba

No hay migración nueva — es lógica de aplicación, no cambia el schema:

```bash
docker-compose up --build api
```

**1. Tenant admin — la variable de sesión debe coincidir con el JWT:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-a"}'

curl http://localhost:3001/auth/db-tenant-check \
  -H "Authorization: Bearer <ACCESS_TOKEN_DE_TENANT_A>"
```

Respuesta esperada:
```json
{
  "jwtTenantId": "<uuid-de-tenant-a>",
  "jwtRole": "TENANT_ADMIN",
  "postgresSessionTenantId": "<el-mismo-uuid-de-tenant-a>",
  "postgresSessionIsSuperAdmin": null
}
```

`jwtTenantId` y `postgresSessionTenantId` **deben ser idénticos**. Esa es la prueba real de que el interceptor funciona — no solo que responde 200, sino que la variable de sesión de PostgreSQL efectivamente refleja el tenant del JWT.

**2. Tenant B — mismo chequeo, para confirmar que no hay contaminación entre requests:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-b"}'

curl http://localhost:3001/auth/db-tenant-check \
  -H "Authorization: Bearer <ACCESS_TOKEN_DE_TENANT_B>"
```

`postgresSessionTenantId` debe ser el uuid de `tenant-b`, distinto al de la prueba anterior — confirma que `AsyncLocalStorage` no está filtrando estado entre requests concurrentes.

**3. Super admin — debe activar el flag, no el tenantId:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bookingsaas.dev","password":"ChangeMe123!"}'

curl http://localhost:3001/auth/db-tenant-check \
  -H "Authorization: Bearer <ACCESS_TOKEN_DE_SUPER_ADMIN>"
```

Respuesta esperada:
```json
{
  "jwtTenantId": null,
  "jwtRole": "SUPER_ADMIN",
  "postgresSessionTenantId": null,
  "postgresSessionIsSuperAdmin": "true"
}
```

**4. (Opcional, prueba de estrés de concurrencia) — 2 requests en paralelo, tenants distintos, confirmar que no se cruzan:**

```bash
curl http://localhost:3001/auth/db-tenant-check -H "Authorization: Bearer <TOKEN_TENANT_A>" &
curl http://localhost:3001/auth/db-tenant-check -H "Authorization: Bearer <TOKEN_TENANT_B>" &
wait
```

Cada respuesta debe traer el `tenantId` correcto de **su propio** token, no una mezcla. Esta es la prueba más importante de todo el paso — si `AsyncLocalStorage` estuviera mal implementado (por ejemplo, si usáramos una variable de módulo compartida en vez de `AsyncLocalStorage`), este sería el test que lo detectaría, no los anteriores.

### Checklist del Paso 4

- [x] Tenant A: `jwtTenantId === postgresSessionTenantId`, `postgresSessionIsSuperAdmin` es `null`.
- [x] Tenant B: mismo chequeo, con el uuid de B, confirmando que no quedó pegado el de A.
- [x] Super admin: `postgresSessionIsSuperAdmin` es `"true"`, `postgresSessionTenantId` es `null`.
- [x] Prueba de concurrencia (2 requests en paralelo, tenants distintos): cada respuesta trae su propio `tenantId`, sin mezcla.

**Verificado:** `GET /auth/db-tenant-check` con token de `tenant-a` y `tenant-b` — JWT y `current_setting('app.current_tenant_id')` coinciden y son distintos entre sí; `SUPER_ADMIN` activa `app.is_super_admin=true` sin tenant; 8 requests concurrentes (4 A + 4 B) no cruzaron contexto. Nota: `current_setting(..., true)` en PostgreSQL devuelve `''` (string vacío) cuando el GUC no se setea; el endpoint usa `NULLIF(..., '')` para reportar `null` como describe este checklist.

Cuando confirmes estos 4 puntos, seguimos con el **Paso 5: migración SQL cruda para habilitar RLS y crear la policy** — ahí es donde `app.current_tenant_id` deja de ser solo una variable de sesión que leemos de vuelta, y empieza a filtrar filas de verdad.

## Paso 5 — RLS: `ENABLE`/`FORCE ROW LEVEL SECURITY` + policy

**El problema que resuelve:** desde el Paso 4, `app.current_tenant_id` y `app.is_super_admin` viajan correctamente en la sesión de PostgreSQL dentro de cada transacción — pero hasta ahora nadie los está *leyendo* para decidir qué filas devolver. Este paso es el que realmente activa el aislamiento a nivel de motor de base de datos.

### Un problema que apareció al diseñar este paso, y cómo se resolvió

Activar `FORCE ROW LEVEL SECURITY` en `users` rompía silenciosamente el login: `AuthService.login/refresh/logout` consultan `users` directo, **antes** de que exista ningún tenant conocido — es literalmente su trabajo resolverlo. Sin ninguna variable de sesión seteada, esas queries habrían dejado de ver cualquier fila, y el login se habría roto para todo el mundo, incluido el super admin.

**Solución:** `AuthService` es, por diseño, el único componente del sistema al que le corresponde operar por encima del aislamiento de tenant — su trabajo es justamente *resolver* la identidad antes de que exista un tenant al cual acotar la query. Se le agregó un método privado `withSystemContext()` que abre una transacción, setea `app.is_super_admin = true`, y ejecuta la query de `users` dentro de ese contexto — mismo mecanismo que ya usa `TenantContextInterceptor`, no un bypass nuevo o paralelo. El seed (`prisma/seed.ts`) tenía exactamente el mismo problema (corre como script administrativo, fuera de cualquier request) y se resolvió igual: toda la lógica de seed corre ahora dentro de una única transacción con el mismo bypass activado.

**Regla que queda establecida de acá en adelante:** cualquier código que necesite leer/escribir `users` (o, más adelante, cualquier tabla con RLS) **fuera** del flujo normal de una request autenticada (scripts, jobs, migraciones de datos) debe pasar explícitamente por este mismo patrón de bypass — nunca crear una ruta de acceso paralela sin él.

### Por qué `FORCE ROW LEVEL SECURITY`, no solo `ENABLE`

`ENABLE ROW LEVEL SECURITY` por sí solo **exime al dueño de la tabla** de sus propias políticas — es el comportamiento por defecto de PostgreSQL. Como la aplicación se conecta con el mismo rol (`booking_admin`) que es dueño de las tablas (el mismo que corre las migraciones), sin `FORCE` la policy simplemente no se aplicaría nunca a las queries de la propia app — un bypass total, silencioso, exactamente lo opuesto de lo que buscamos. `FORCE` cierra esa puerta trasera.

**Nota — rol de runtime (adelantado desde Fase 10):** `FORCE` solo alcanza si el rol de la app **no** es superuser. En Docker, `POSTGRES_USER` (`booking_admin`) siempre es superuser y bypasea RLS. Por eso el runtime de la API usa `booking_app` (`DATABASE_URL`) y las migraciones siguen con `booking_admin` (`DATABASE_MIGRATE_URL`). En AWS (Fase 10) el mismo patrón se formaliza con roles/credenciales separados en RDS.

### Por qué `NULLIF(..., '')` antes de castear a `::uuid`

Esto ya lo descubrieron ustedes mismos en el Paso 4 con el endpoint de diagnóstico, y aplica con más fuerza acá: `current_setting(name, true)` devuelve `''` (string vacío), no `NULL`, cuando la variable de sesión nunca se seteó. Castear `''` directo a `::uuid` **lanza un error de PostgreSQL** (`invalid input syntax for type uuid`), lo que rompería catastróficamente cualquier query contra `users` si por algún motivo el interceptor no llegó a correr (bug, conexión directa, script sin el bypass) — exactamente el fallo catastrófico que se pidió evitar desde el diseño original de esta fase ("que la query retorne 0 filas por defecto en lugar de fallar la transacción"). `NULLIF('', '')` convierte el string vacío en `NULL` antes del cast; comparar una columna contra `NULL` es `NULL` (falso) en SQL, así que el resultado seguro ante ausencia de contexto es "cero filas", no un error.

### La policy

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

`tenant_id` es `TEXT` (Prisma `String`), no `uuid` — por eso la comparación es textual, sin `::uuid`. Castear a `uuid` rompe la migración (`operator does not exist: text = uuid`).

`USING` controla qué filas existentes son visibles (`SELECT`/`UPDATE`/`DELETE`); `WITH CHECK` controla qué filas se pueden **crear o dejar** tras un `INSERT`/`UPDATE` — se escriben ambas explícitamente, en vez de confiar en que Postgres reutilice `USING` para `WITH CHECK` por defecto (lo haría si se omitiera, pero en algo de seguridad preferimos que la regla esté escrita, no implícita).

### Hallazgo crítico: `FORCE` no basta si el rol de la app es superuser

En Docker, el usuario definido por `POSTGRES_USER` (`booking_admin`) es **siempre superuser**. Los superusers bypasean RLS aunque exista `FORCE ROW LEVEL SECURITY`. Resultado: las policies parecían aplicadas (`\d+ users` las listaba) pero `SELECT * FROM users` seguía devolviendo todas las filas.

**Fix de infraestructura (adelantado respecto a la nota de Fase 10):**
- Rol runtime no-superuser `booking_app` (creado en [`docker/postgres/init.sql`](docker/postgres/init.sql)).
- `DATABASE_URL` apunta a `booking_app` (la API y el seed corren bajo RLS de verdad).
- `DATABASE_MIGRATE_URL` apunta a `booking_admin` — las migraciones DDL siguen corriendo como owner:
  ```bash
  docker exec -e DATABASE_URL="$DATABASE_MIGRATE_URL" booking-api npx prisma migrate deploy
  ```
- Las verificaciones de `psql` del checklist **deben** usarse como `-U booking_app`, no como `-U booking_admin`.

**Archivos:**
- Migración nueva: `enable_rls_users` (contenido de arriba, sin `::uuid`).
- `apps/api/src/auth/auth.service.ts` — nuevo método privado `withSystemContext()`; `login`, `refresh`, `logout` e `issueTokenPair` ahora pasan por él para tocar `users`.
- `apps/api/src/auth/auth.controller.ts` — `db-tenant-check` actualizado con `NULLIF` (mismo fix que ya habían aplicado ustedes).
- `apps/api/prisma/seed.ts` — toda la lógica corre dentro de una única transacción con el bypass de sistema activado.
- `docker/postgres/init.sql`, `.env`, `.env.example` — rol `booking_app` + separación runtime/migrate.

### Comandos de ejecución

```bash
# 1. Crear la migración vacía (Prisma no puede generar DDL de RLS desde el schema)
docker exec -it booking-api npx prisma migrate dev --create-only --name enable_rls_users
```

Esto crea `apps/api/prisma/migrations/<timestamp>_enable_rls_users/migration.sql`, vacío. Ábranlo y peguen exactamente el SQL de la sección "La policy" de arriba.

```bash
# 2. Aplicar la migración ya editada (como booking_admin / owner)
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" booking-api npx prisma migrate deploy
```

```bash
# 3. Reiniciar la API para tomar DATABASE_URL=booking_app
docker-compose up -d api
```

```bash
# 4. Re-correr el seed — ahora debe seguir funcionando gracias al bypass de sistema
docker exec booking-api npm run seed
```

### Verificación directa en PostgreSQL (antes de tocar la API)

**Confirmar que RLS está activo:**

```bash
docker exec -it booking-postgres psql -U booking_admin -d booking_saas -c "\d+ users"
```

Debe mostrar `Policies:` con la policy `tenant_isolation` listada al final.

**La prueba definitiva — filtrado real, sin pasar por la aplicación (como `booking_app`, no como `booking_admin`):**

```bash
docker exec -it booking-postgres psql -U booking_app -d booking_saas
```

Dentro de la sesión de `psql`:

```sql
-- Sin ninguna variable de sesión seteada: debe devolver 0 filas, NO un error
SELECT email, tenant_id FROM users;

-- Seteando el contexto de tenant-a: solo debe verse SU fila
SELECT set_config('app.current_tenant_id', '<UUID_DE_TENANT_A>', false);
SELECT email, tenant_id FROM users;

-- Cambiando a tenant-b en la MISMA sesión: ahora solo la fila de tenant-b
SELECT set_config('app.current_tenant_id', '<UUID_DE_TENANT_B>', false);
SELECT email, tenant_id FROM users;

-- Bypass de super admin: deben verse TODAS las filas
SELECT set_config('app.is_super_admin', 'true', false);
SELECT email, tenant_id FROM users;
```

(Usamos `false` en vez de `true` como tercer argumento acá porque en `psql` no hay una transacción explícita abierta — `false` hace el `set_config` persistente para el resto de la sesión de `psql`, no solo para una transacción. En la app real, siempre es `true`, ligado a la transacción del interceptor.)

**Importante:** si corrés estos `SELECT` como `-U booking_admin`, vas a ver **todas** las filas siempre. `booking_admin` es superuser (Docker `POSTGRES_USER`) y bypasea RLS aunque exista `FORCE`. El checklist solo es válido como `booking_app`.

**Sustituyan `<UUID_DE_TENANT_A>` y `<UUID_DE_TENANT_B>`** por los valores reales:

```bash
docker exec -it booking-postgres psql -U booking_admin -d booking_saas -c "SELECT id, slug FROM tenants;"
```

### Verificación end-to-end vía la API (Postman/curl)

Repitan los mismos 4 `curl` del Paso 4 (`/auth/db-tenant-check` con tenant A, tenant B, super admin) — deben seguir devolviendo exactamente lo mismo que en el Paso 4. Si algo cambió (por ejemplo, un login que antes funcionaba ahora da error), es señal de que el bypass de `AuthService` no quedó bien aplicado.

Además, agreguen esta prueba nueva, específica de este paso:

```bash
# Login normal, debe seguir funcionando exactamente igual que en el Paso 4
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tenant.dev","password":"ChangeMe123!","tenantSlug":"tenant-a"}'
```

Si esto devuelve 401 o un error 500, **RLS está bloqueando el login** — significa que el bypass de `withSystemContext()` no se aplicó correctamente en alguna rama del código.

### Checklist del Paso 5

- [x] `\d+ users` en psql muestra la policy `tenant_isolation`.
- [x] `SELECT * FROM users;` sin ninguna variable de sesión seteada → 0 filas, sin error (confirma el fallback seguro de `NULLIF`). **Verificado como `-U booking_app`.**
- [x] Con `app.current_tenant_id` = uuid de tenant-a → solo aparece esa fila.
- [x] Cambiando a uuid de tenant-b en la misma sesión → solo aparece esa otra fila.
- [x] Con `app.is_super_admin = 'true'` → aparecen todas las filas.
- [x] Login, refresh y logout siguen funcionando exactamente igual que en el Paso 4 (prueba de que el bypass de `AuthService` no rompió nada).
- [x] El seed (`npm run seed`) sigue corriendo sin error tras el rebuild.

**Verificado:** migration `enable_rls_users` aplicada (`relrowsecurity` + `relforcerowsecurity`); filtrado real solo como `booking_app`; API conectada a `booking_app` vía `DATABASE_URL`; login/refresh/logout + `db-tenant-check` OK; seed idempotente OK.

Cuando confirmes estos 7 puntos, seguimos con el **Paso 7: tests de integración de aislamiento entre tenants** — el cierre formal de toda la Fase 3 (el Paso 6, seed con 2 tenants, ya quedó cubierto desde el Paso 1).

## Paso 7 — Tests de integración de aislamiento (cierre formal de la Fase 3)

**Qué prueba:** todo lo construido en los Pasos 1 a 5, junto, en un solo suite automatizado — login con `tenantSlug`, `TenantGuard`, `TenantContextInterceptor`, y la policy RLS real. Se prueba en dos capas independientes:

1. **Capa HTTP** (`supertest` contra la app completa) — confirma que el JWT y la sesión de PostgreSQL siempre coinciden, para tenant A, tenant B, super admin, sin token, y bajo concurrencia.
2. **Capa de base de datos** (Prisma directo, sin pasar por HTTP) — la prueba más honesta de todas: abre transacciones, setea `app.current_tenant_id`/`app.is_super_admin` a mano, y confirma que PostgreSQL filtra filas de verdad. Si esta capa pasara pero la capa HTTP fallara, sabríamos que el problema está en el interceptor, no en la policy — y viceversa.

**Acoplamiento conocido, dicho explícitamente:** los tests dependen de los datos del seed (`tenant-a`, `tenant-b`, `admin@tenant.dev`, el super admin) en vez de crear sus propios fixtures descartables. Construir fixtures de test propios con setup/teardown es lo "más correcto" a largo plazo, pero es infraestructura que no se justifica todavía para un proyecto en esta etapa — lo dejo anotado para que no se confunda con un descuido más adelante.

**Lo que este suite NO prueba todavía, a propósito:** la regla "acceder al recurso de otro tenant por ID debe devolver 404, nunca 403" del Technical Plan original (Fase 0) — porque **todavía no existe ningún endpoint de recurso real con `tenant_id`** (branches, servicios, etc. llegan en la Fase 4 general del roadmap). Está declarado como `it.todo(...)` en el archivo de test, no omitido en silencio, para que no se pierda cuando lleguemos a esa fase.

**Archivos nuevos:**
- `apps/api/test/jest-e2e.json` — configuración de Jest para e2e (el script `test:e2e` ya existía en `package.json` desde la Fase 1, pero apuntaba a un archivo que no existía todavía).
- `apps/api/test/tenant-isolation.e2e-spec.ts` — el suite completo.

**Archivos modificados:**
- `apps/api/package.json` — nuevas devDependencies: `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`, `@nestjs/testing`.
- `apps/api/tsconfig.json` — `esModuleInterop: true` (requerido por el import default de `supertest`; no debería afectar nada del código existente).

### Comandos de ejecución

```bash
docker-compose up --build api
docker exec -it booking-api npm run seed   # asegurar que tenant-a/tenant-b/super admin existan
docker exec -it booking-api npm run test:e2e
```

Salida esperada: 9 tests pasando (`5` de la capa HTTP + `3` de la capa de base de datos + `1` marcado `todo`), 0 fallando.

### Checklist del Paso 7 — cierre de la Fase 3

- [x] `npm run test:e2e` corre sin errores de compilación (confirma que `esModuleInterop` y las dependencias nuevas quedaron bien instaladas).
- [x] Los 8 tests reales (no el `.todo`) pasan en verde.
- [x] Si corrés el suite dos veces seguidas, sigue pasando (confirma que no depende de estado que se destruye a sí mismo — el seed es idempotente, los tests no modifican filas existentes, solo leen).
- [x] Revisaste el `it.todo` y entendés por qué existe (no es un test roto, es un recordatorio explícito para la Fase 4).

### Fase 3 — cierre formal

Con los 7 pasos completos, esto es lo que hoy garantiza el sistema, de punta a punta:

- Un usuario no puede loguearse en un tenant al que no pertenece (`tenantSlug` + unique compuesto).
- El JWT y la sesión de PostgreSQL siempre coinciden en `tenantId` (`TenantContextInterceptor`).
- PostgreSQL **rechaza filas de otro tenant a nivel de motor**, incluso si el código de aplicación tuviera un bug (RLS con `FORCE`, probado con un rol que de verdad no es superuser).
- El único bypass posible (`SUPER_ADMIN`) es explícito, visible en el código, y auditable — no un privilegio oculto de conexión.
- Todo lo anterior está cubierto por un test automatizado, no solo por verificación manual.

Lo que queda deliberadamente fuera del alcance de esta fase, para la Fase 4 general del roadmap: los primeros módulos de dominio reales (branches, services, staff) que efectivamente usarán `PrismaService.client` y quedarán protegidos por esta misma infraestructura.

---

# Fase 4: Entidades base — Bitácora

**Alcance de la fase** (roadmap original): Branches, Services, Staff (CRUD) — "Admin puede configurar su negocio completo".

## Paso 1 — Módulo `Branches`

**Por qué va primero:** es la entidad de la que dependen `services` y `staff` (ambos se asignarán a una sucursal más adelante) — mismo criterio de orden por dependencias que ya usamos con `Tenant` antes que `User` en la Fase 3.

**Por qué este paso importa más de lo que parece:** es el primer módulo de dominio real que usa `PrismaService.client` — el getter que quedó preparado desde el Paso 4 de la Fase 3 pero nunca tuvo un consumidor real hasta ahora. Toda la infraestructura de `AsyncLocalStorage` + `TenantContextInterceptor` + RLS finalmente protege datos de negocio, no solo la tabla `users`.

### Decisiones de diseño

**`@TenantScoped()` — el decorador compuesto que anticipamos en la Fase 3.** En el Paso 4 de esa fase dijimos explícitamente que crear este decorador antes de tener 2-3 controllers reales sería YAGNI. Con `BranchesController` ya tenemos el segundo consumidor real de `JwtAuthGuard + TenantGuard + RolesGuard + TenantContextInterceptor`, así que la repetición ya justifica la abstracción. Se aplicó también retroactivamente a los endpoints de diagnóstico de `AuthController` (`tenant-context`, `db-tenant-check`), que antes listaban los 4 elementos a mano.

**Sin capa de repositorio separada.** Mismo criterio ya establecido en el Phase 0 Technical Plan: `branches` es CRUD simple, un service llamando a Prisma directo es correcto — una capa de repositorio acá sería abstracción sin beneficio real. Donde sí importa la disciplina es en usar `this.prisma.client.branch.xxx` (el cliente con contexto RLS activo) y nunca `this.prisma.branch.xxx` directo, que bypasearía el aislamiento por completo.

**`tenantId` viene del JWT, nunca del body de la request.** Aunque el `WITH CHECK` de la policy RLS rechazaría igual un intento de crear una sucursal para otro tenant, el controller ni siquiera le da esa opción al cliente — es defensa en profundidad, no la única línea de defensa.

**El 404-no-403 dejó de ser una promesa y pasó a ser un mecanismo verificado.** `findOne()` no tiene ningún `if (branch.tenantId !== callerTenantId) throw 403` — no hace falta: si el `id` pertenece a otro tenant, RLS ya hizo esa fila invisible para la conexión, así que `findFirst` devuelve `null` exactamente como si la fila no existiera. El test de la Fase 3 que quedó como `it.todo` (pendiente de un recurso real) ahora está implementado de verdad contra `/branches`.

### Migraciones necesarias

```bash
# Runtime usa booking_app; las migraciones deben correr como booking_admin (owner).
# En Docker non-interactive preferí crear/aplicar con migrate deploy (ver migraciones
# 20260905220300_add_branches y 20260905220301_enable_rls_branches en el repo).

docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy

docker exec booking-api npx prisma generate
docker-compose restart api
```

SQL de RLS aplicado en `enable_rls_branches` (mismo patrón que `users`, comparación en TEXT sin `::uuid`):

```sql
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branches
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

**Nota importante:** no hace falta un `GRANT` manual para `booking_app` en esta tabla nueva — el `ALTER DEFAULT PRIVILEGES` que quedó configurado en `docker/postgres/init.sql` (fix del Paso 5) ya cubre automáticamente cualquier tabla que `booking_admin` cree de acá en adelante. Este es el primer paso donde ese fix paga dividendos reales.

### Archivos nuevos

- `apps/api/src/common/decorators/tenant-scoped.decorator.ts`
- `apps/api/src/branches/` (`branches.module.ts`, `branches.controller.ts`, `branches.service.ts`, `dto/create-branch.dto.ts`, `dto/update-branch.dto.ts`)
- `apps/api/tsconfig.build.json` + `nest-cli.json` actualizado (`tsConfigPath`) — fix de build ya aplicado por ustedes en el cierre de la Fase 3, incluido acá para que el proyecto compile.

### Archivos modificados

- `apps/api/prisma/schema.prisma` — modelo `Branch` + relación en `Tenant`.
- `apps/api/src/app.module.ts` — registra `BranchesModule`.
- `apps/api/src/auth/auth.controller.ts` — usa `@TenantScoped()` en vez de guards manuales.
- `apps/api/package.json` — nueva dependencia `@nestjs/mapped-types` (requerida por `PartialType` en `UpdateBranchDto`).
- `apps/api/test/tenant-isolation.e2e-spec.ts` — el `it.todo` de la Fase 3 ahora es un test real contra `/branches`.

### Comandos de prueba

```bash
docker-compose up --build api
```

**1. Tenant admin crea una sucursal:**

```bash
curl -X POST http://localhost:3001/branches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"name":"Sucursal Centro","address":"Calle 10 #5-20"}'
```

Debe responder `201` con la sucursal creada, `tenantId` coincidiendo con el tenant del token.

**2. Tenant admin lista sus sucursales:**

```bash
curl http://localhost:3001/branches \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>"
```

**3. La prueba clave — tenant B pide la sucursal de tenant A por ID directo:**

```bash
curl -i http://localhost:3001/branches/<ID_DE_LA_SUCURSAL_DE_TENANT_A> \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_B>"
```

Debe devolver **404**, no 403 ni 200.

**4. Un `STAFF` o `CLIENT` (si ya tuvieran usuarios de prueba) no puede crear sucursales:**

```bash
curl -i -X POST http://localhost:3001/branches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_DE_UN_ROL_NO_TENANT_ADMIN>" \
  -d '{"name":"Intento no autorizado"}'
```

Debe devolver **403** (`RolesGuard` bloqueando por `@Roles(TENANT_ADMIN)`).

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **12 tests** en verde: los **9** de la Fase 3 + **3** nuevos de `branches` (el `it.todo` de 404-vs-403 quedó reemplazado por tests reales).

### Checklist del Paso 1 (Fase 4)

- [x] Migraciones `add_branches` y `enable_rls_branches` aplicadas sin error.
- [x] Crear sucursal como `TENANT_ADMIN` → 201, con el `tenantId` correcto.
- [x] Listar sucursales devuelve solo las del tenant del token.
- [x] Pedir por ID la sucursal de otro tenant → 404 (no 403, no 200).
- [x] Actualizar por ID la sucursal de otro tenant → 404.
- [x] Rol sin `TENANT_ADMIN` intentando crear/editar → 403 (verificado con `SUPER_ADMIN`).
- [x] `npm run test:e2e` pasa con los tests nuevos de `branches` incluidos (`12 passed`).

**Verificado:** tabla `branches` con RLS+FORCE+policy `tenant_isolation`; grants a `booking_app` vía default privileges; CRUD aislado por tenant; e2e 12/12.

Cuando confirmes este checklist, seguimos con el **Paso 2 de la Fase 4: módulo `Services`** (los servicios que ofrece el negocio — duración, precio, buffer — que en la Fase 6 general del roadmap se van a incorporar directamente al `time_range` de las reservas).

## Paso 2 — Módulo `Services`

**Relación con `Branches`:** cada `Service` pertenece a exactamente una `Branch` (`branchId` obligatorio). Es una decisión de diseño, no la única posible — un catálogo de servicios a nivel de tenant, compartido por varias sucursales con una plantilla común, es una necesidad real en negocios con múltiples sucursales idénticas, pero es un problema distinto (plantilla vs. instancia) que no vamos a resolver todavía. Lo revisamos el día que duplicar un servicio a mano entre sucursales sea un dolor recurrente de verdad, no antes.

**`tenantId` denormalizado en `Service`, igual que en `Branch`:** mismo motivo que ya documentamos — RLS y los guards necesitan filtrar por `tenant_id` directo en la tabla, sin depender de un join a través de `Branch`.

**`price` es `Decimal(10,2)`, nunca `Float`.** El dinero nunca debe representarse en punto flotante binario — no es una preocupación teórica, es el tipo de bug que aparece silenciosamente al sumar totales sobre muchas reservas. Prisma mapea `Decimal` de forma nativa a `numeric` de PostgreSQL.

**`durationMinutes` + `bufferMinutes` — el porqué ya está en el Technical Plan de la Fase 0.** Este es el campo que, en la Fase 6 general del roadmap, se va a sumar al `time_range` efectivo de una reserva, para que el exclusion constraint de PostgreSQL bloquee automáticamente el tiempo de limpieza/preparación — sin lógica extra en la aplicación. No se usa todavía (no existe `Booking` como modelo), pero el campo ya queda listo para cuando llegue esa fase.

**Validar `branchId` reutilizando RLS, no comparando `tenantId` a mano.** `ServicesService.create()` busca la sucursal con `this.prisma.client.branch.findFirst(...)` — la misma conexión con contexto de tenant activo que ya usa `BranchesService`. Si el `branchId` pertenece a otro tenant, RLS ya la hizo invisible, así que la query no la encuentra y el resultado es un 404 — ni una sola línea de código compara `branch.tenantId === user.tenantId` en ningún lado. Es el mismo mecanismo del Paso 1, aplicado por segunda vez, no un caso especial nuevo.

**`update()` revalida el `branchId` si viene en el body.** Mover un servicio a una sucursal que el caller no puede ver debe fallar exactamente igual que crearlo ahí — mismo chequeo, no una regla nueva para el caso de edición.

### Modelo Prisma

```prisma
model Service {
  id       String @id @default(uuid())

  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  branchId String @map("branch_id")
  branch   Branch @relation(fields: [branchId], references: [id])

  name             String
  durationMinutes  Int     @map("duration_minutes")
  bufferMinutes    Int     @default(0) @map("buffer_minutes")
  price            Decimal @db.Decimal(10, 2)

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@unique([branchId, name])
  @@index([tenantId])
  @@map("services")
}
```

(`Branch` y `Tenant` ganan la relación `services Service[]` — Prisma exige el lado inverso de la relación.)

### Migraciones y privilegios

Mismo patrón de dos pasos que `branches` — Prisma genera el `CREATE TABLE`, la policy RLS se escribe a mano:

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --name add_services

docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name enable_rls_services
```

Pegar en el archivo generado por el segundo comando:

```sql
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON services
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy

docker exec booking-api npx prisma generate
docker-compose restart api
```

**No hace falta ningún `GRANT` manual para `booking_app`** — el `ALTER DEFAULT PRIVILEGES` de `docker/postgres/init.sql` (fix del Paso 5 de la Fase 3) cubre automáticamente esta tabla nueva también, igual que cubrió `branches`.

### Archivos nuevos

- `apps/api/src/services/` (`services.module.ts`, `services.controller.ts`, `services.service.ts`, `dto/create-service.dto.ts`, `dto/update-service.dto.ts`)
- `apps/api/test/services.e2e-spec.ts`

### Archivos modificados

- `apps/api/prisma/schema.prisma` — modelo `Service` + relación `services` en `Branch` y `Tenant`.
- `apps/api/src/app.module.ts` — registra `ServicesModule`.

### Comandos de prueba

```bash
docker exec booking-api npm run seed
```

**1. Tenant admin crea un servicio en su propia sucursal:**

```bash
curl -X POST http://localhost:3001/services \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"branchId":"<ID_SUCURSAL_TENANT_A>","name":"Corte de cabello","durationMinutes":30,"bufferMinutes":10,"price":25000}'
```

**2. La prueba clave — tenant B intenta crear un servicio en una sucursal de tenant A:**

```bash
curl -i -X POST http://localhost:3001/services \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_B>" \
  -d '{"branchId":"<ID_SUCURSAL_TENANT_A>","name":"Intento cross-tenant","durationMinutes":30,"price":5000}'
```

Debe devolver **404** (la sucursal de tenant A es invisible para tenant B) — nunca 201, nunca 403.

**3. Listar servicios filtrados por sucursal:**

```bash
curl "http://localhost:3001/services?branchId=<ID_SUCURSAL_TENANT_A>" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>"
```

**4. Rol sin `TENANT_ADMIN` no puede crear servicios:**

```bash
curl -i -X POST http://localhost:3001/services \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_SUPER_ADMIN>" \
  -d '{"branchId":"<ID_SUCURSAL_TENANT_A>","name":"No debería crear esto","durationMinutes":30,"price":1000}'
```

Debe devolver **403**.

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **18 tests** en verde: los 12 ya existentes (9 de Fase 3 + 3 de `branches`) + 6 nuevos de `services`.

### Checklist del Paso 2

- [x] Migraciones `add_services` y `enable_rls_services` aplicadas sin error.
- [x] Crear servicio en sucursal propia → 201.
- [x] `bufferMinutes` omitido → default `0` en la respuesta.
- [x] Crear servicio con `branchId` de otro tenant → 404 (no 403, no 201).
- [x] Listar con `?branchId=` filtra correctamente.
- [x] Tenant B no ve ningún servicio de tenant A ni siquiera sin filtro.
- [x] Rol sin `TENANT_ADMIN` → 403.
- [x] `npm run test:e2e` → 18/18 en verde.

Cuando confirmes este checklist, seguimos con el **Paso 3 de la Fase 4: módulo `Staff`** — el último de los tres antes de poder pasar a la Fase 5 general del roadmap (Disponibilidad), que es donde `branches` + `services` + `staff` + `schedules` finalmente se combinan para calcular horarios libres de verdad.

## Paso 3 — Módulo `Staff`

**Antes de nada: el fix que hicieron ustedes en el Paso 2 (relación bidireccional faltante en `Tenant`) se volvió a auditar acá.** Este paso agrega 4 relaciones nuevas al schema — audité cruzado cada `@relation` contra su campo inverso antes de escribir una sola línea de código NestJS, para no repetir el mismo error. El detalle completo de esa auditoría está en el propio schema; ninguna relación quedó a medias esta vez.

### Decisiones de diseño

**`POST /staff` crea el `User` y el `Staff` en la misma operación.** Todavía no existe un flujo de invitación por email (eso es la Fase 17 general del roadmap, Notificaciones), así que este endpoint genera una contraseña temporal, la hashea, y la devuelve **una sola vez** en la respuesta. Es una simplificación deliberada y documentada, no el diseño final — el día que exista un flujo de invitación real, este endpoint deja de manejar credenciales él mismo.

**La atomicidad viene de la arquitectura, no de un `$transaction` nuevo.** `StaffService.create()` no abre ninguna transacción propia — ya está corriendo dentro de la transacción que `TenantContextInterceptor` abrió para toda la request (vía `@TenantScoped()`). Si la creación del `Staff` o de los `StaffService` falla después de haber creado el `User`, todo se revierte junto. Este es un pago directo de la infraestructura que construimos en la Fase 3: no tuvimos que pensar en esto, ya viene incluido.

**`serviceIds` debe pertenecer a la MISMA sucursal que `branchId`.** Es una regla de negocio (un empleado de la sucursal Centro no puede estar calificado para un servicio que solo existe en la sucursal Norte), validada en `StaffService` (el service de NestJS) contra la base de datos — no es un constraint de PostgreSQL, porque expresar "estos dos IDs deben compartir el mismo `branch_id`" como `CHECK` constraint requeriría un trigger, complejidad que no se justifica para una regla tan simple de verificar en código.

**Un solo mensaje genérico de error para `serviceIds` inválidos.** Si un `serviceId` no existe, pertenece a otra sucursal, o pertenece a otro tenant (invisible por RLS), la respuesta es la misma: `400` con un mensaje genérico. No se distingue cuál de los tres casos ocurrió — mismo principio de no-fuga-de-información que venimos aplicando desde el login.

**`update()` reemplaza la lista completa de `serviceIds`, no hace add/remove incremental.** Modelo mental más simple para un panel de administración ("esta es la lista completa ahora"), al costo de no poder diferenciar qué cambió específicamente. Lo revisamos si el panel algún día necesita agregar/quitar servicios uno por uno en vez de mandar la lista completa.

**Gap conocido, dicho explícitamente — no resuelto en este paso:** dar de baja un `Staff` (soft delete) **no revoca el acceso de login del `User` asociado**. Todavía no existe un flag `isActive`/`suspended` en `User`. Un empleado "eliminado" del panel administrativo técnicamente sigue pudiendo loguearse — simplemente deja de aparecer en los listados de staff. Queda anotado para la Fase 13 general del roadmap (Production hardening), no resuelto silenciosamente acá para no generar una falsa sensación de seguridad.

### Modelos Prisma (relaciones bidireccionales completas)

```prisma
model Staff {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  branchId String @map("branch_id")
  branch   Branch @relation(fields: [branchId], references: [id])

  userId String @unique @map("user_id")
  user   User   @relation(fields: [userId], references: [id])

  services StaffService[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@index([tenantId])
  @@map("staff")
}

model StaffService {
  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  staffId String @map("staff_id")
  staff   Staff  @relation(fields: [staffId], references: [id])

  serviceId String  @map("service_id")
  service   Service @relation(fields: [serviceId], references: [id])

  @@id([staffId, serviceId])
  @@index([tenantId])
  @@map("staff_services")
}
```

Cambios en modelos existentes: `Tenant` gana `staff Staff[]` y `staffServices StaffService[]`; `Branch` gana `staff Staff[]`; `Service` gana `staffAssignments StaffService[]`; `User` gana `staff Staff?` (uno-a-uno, nullable).

### Migraciones y privilegios

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --name add_staff

docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name enable_rls_staff_module
```

Pegar en el archivo generado por el segundo comando (dos tablas nuevas, misma policy en ambas):

```sql
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );

ALTER TABLE staff_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_services FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_services
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy

docker exec booking-api npx prisma generate
docker-compose restart api
```

Sin `GRANT` manual — `ALTER DEFAULT PRIVILEGES` (fix del Paso 5, Fase 3) cubre ambas tablas nuevas automáticamente.

### Archivos nuevos

- `apps/api/src/staff/` (`staff.module.ts`, `staff.controller.ts`, `staff.service.ts`, `dto/create-staff.dto.ts`, `dto/update-staff.dto.ts`)
- `apps/api/test/staff.e2e-spec.ts`

### Archivos modificados

- `apps/api/prisma/schema.prisma` — modelos `Staff`, `StaffService`, relaciones inversas en `Tenant`/`Branch`/`Service`/`User`.
- `apps/api/src/app.module.ts` — registra `StaffModule`.

### Comandos de prueba

```bash
docker exec booking-api npm run seed
```

**1. Crear staff con servicio asignado:**

```bash
curl -X POST http://localhost:3001/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"email":"ana@tenant-a.dev","branchId":"<ID_SUCURSAL_TENANT_A>","serviceIds":["<ID_SERVICIO_DE_ESA_SUCURSAL>"]}'
```

Guarda el `temporaryPassword` de la respuesta — es la única vez que aparece.

**2. Mismo email dos veces → 409:**

```bash
curl -i -X POST http://localhost:3001/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"email":"ana@tenant-a.dev","branchId":"<ID_SUCURSAL_TENANT_A>"}'
```

**3. `serviceId` de otra sucursal → 400:**

```bash
curl -i -X POST http://localhost:3001/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"email":"otro@tenant-a.dev","branchId":"<ID_SUCURSAL_TENANT_A>","serviceIds":["<ID_SERVICIO_DE_OTRA_SUCURSAL>"]}'
```

**4. Tenant B intenta crear staff en sucursal de tenant A → 404:**

```bash
curl -i -X POST http://localhost:3001/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_B>" \
  -d '{"email":"intento@tenant-b.dev","branchId":"<ID_SUCURSAL_TENANT_A>"}'
```

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **24 tests** en verde: 18 ya existentes + 6 nuevos de `staff`.

### Checklist del Paso 3

- [x] Migraciones `add_staff` y `enable_rls_staff_module` aplicadas sin error.
- [x] Crear staff con `serviceIds` válidos → 201, con `temporaryPassword` presente.
- [x] Email duplicado dentro del mismo tenant → 409.
- [x] `serviceId` de otra sucursal → 400.
- [x] Crear staff en sucursal de otro tenant → 404 (no 403, no 201).
- [x] Rol sin `TENANT_ADMIN` → 403.
- [x] Tenant B no ve ningún `staff` de tenant A en el listado.
- [x] `npm run test:e2e` → 24/24 en verde.

### Fase 4 — cierre

Con `Branches`, `Services` y `Staff` completos, el roadmap general marca la **Fase 5: Disponibilidad** como siguiente — calcular slots libres combinando `schedules` (que todavía no existe como modelo) + `staff` + `bookings` (tampoco existe todavía). Antes de esa fase hace falta decidir explícitamente el modelo de `schedules` (horarios recurrentes + excepciones), que quedó mencionado en el Technical Plan original pero nunca se detalló a fondo — ese es el punto natural para retomar el diseño antes de escribir código.

---

# Fase 5: Disponibilidad — Bitácora

## Paso 0 — Diseño de `Schedules` (acordado antes de escribir código)

**Decisión central: `StaffSchedule` (horario del empleado) y `BranchSchedule` (horario de apertura de la sucursal) son conceptos distintos.** Implementamos primero `StaffSchedule` — es lo que responde la pregunta central ("¿puedo agendar con Ana?"). `BranchSchedule` queda como **limitación conocida y explícita** para un paso posterior: hoy el sistema no valida que un horario de staff caiga dentro del horario de apertura de su sucursal.

**Zona horaria: hora de pared (`TIME` sin zona), nunca UTC pre-convertido.** Una regla recurrente como "lunes 9am" solo tiene sentido en hora local — guardarla como offset UTC fijo la rompería en cada cambio de horario de verano. La zona horaria (`branch.timezone`, vía `staff.branch`) se resuelve recién en el momento de calcular un slot concreto contra una fecha real — eso es trabajo del próximo paso (cálculo de disponibilidad), no de este.

**Reglas de negocio confirmadas antes de implementar:**
1. Una excepción (`StaffScheduleException`) **reemplaza** el horario semanal recurrente ese día — no se combinan.
2. `isAvailable: true` exige `startTime`/`endTime`; `isAvailable: false` los prohíbe (una excepción "no disponible" con horario es una contradicción, se rechaza).
3. Sin turnos que cruzan medianoche en v1 — `endTime` debe ser estrictamente posterior a `startTime` dentro del mismo día calendario.
4. Sin `BranchSchedule` todavía — limitación conocida, no un descuido.

**Por qué no hay exclusion constraint para solapamiento de horarios**, a diferencia del futuro `time_range` de `bookings`: editar el horario de un empleado es una acción administrativa de baja frecuencia (un `TENANT_ADMIN` configurando el horario una vez), no el problema de concurrencia real que sí existe en el flujo de reservas de clientes. La validación de solapamiento vive en `StaffSchedulesService`, en aplicación — proporcional al riesgo real, no un exclusion constraint con un range type custom de PostgreSQL que no se justifica acá.

## Paso 1 — Implementación

### Modelos Prisma

```prisma
model StaffSchedule {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  staffId String @map("staff_id")
  staff   Staff  @relation(fields: [staffId], references: [id])

  dayOfWeek Int @map("day_of_week") // ISO-8601: 1=lunes ... 7=domingo

  startTime DateTime @map("start_time") @db.Time()
  endTime   DateTime @map("end_time") @db.Time()

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@index([staffId, dayOfWeek])
  @@map("staff_schedules")
}

model StaffScheduleException {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  staffId String @map("staff_id")
  staff   Staff  @relation(fields: [staffId], references: [id])

  date        DateTime @db.Date
  isAvailable Boolean  @map("is_available")
  startTime   DateTime? @map("start_time") @db.Time()
  endTime     DateTime? @map("end_time") @db.Time()
  reason      String?

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([staffId, date])
  @@index([tenantId])
  @@map("staff_schedule_exceptions")
}
```

Relaciones inversas agregadas: `Tenant.staffSchedules`, `Tenant.staffScheduleExceptions`, `Staff.schedules`, `Staff.scheduleExceptions` — auditadas cruzado contra cada `@relation` antes de generar la migración (14 relaciones en total en el schema, todas confirmadas de ambos lados).

### Nota técnica de Prisma — `@db.Time()`

Prisma representa `TIME` de PostgreSQL como un objeto `Date` de JavaScript con fecha de referencia fija `1970-01-01`; solo los componentes de hora/minuto son significativos. `time.util.ts` centraliza la conversión hacia/desde strings `"HH:mm"` (formato que usa la API pública) para que ningún controller o service tenga que lidiar con ese detalle directamente.

### Migraciones

```bash
# 1. Prisma genera las dos tablas desde el schema
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --name add_staff_schedules

# 2. CHECK constraints de orden de horas — Prisma no los expresa nativamente
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name add_staff_schedule_time_constraints
```

Pegar en el archivo generado por el paso 2:

```sql
ALTER TABLE staff_schedules
  ADD CONSTRAINT staff_schedules_time_order CHECK (end_time > start_time);

ALTER TABLE staff_schedule_exceptions
  ADD CONSTRAINT staff_schedule_exceptions_time_order
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
```

```bash
# 3. RLS — mismo patrón que branches/services/staff
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name enable_rls_staff_schedules
```

Pegar en el archivo generado por el paso 3:

```sql
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_schedules
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );

ALTER TABLE staff_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedule_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_schedule_exceptions
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy

docker exec booking-api npx prisma generate
docker-compose restart api
```

Sin `GRANT` manual — cubierto por `ALTER DEFAULT PRIVILEGES`, igual que las 4 tablas anteriores.

### Archivos nuevos

- `apps/api/src/staff-schedules/` completo: `staff-schedules.module.ts`, `staff-schedules.controller.ts`, `staff-schedules.service.ts`, `staff-schedule-exceptions.controller.ts`, `staff-schedule-exceptions.service.ts`, `time.util.ts`, `dto/` (4 archivos).
- `apps/api/test/staff-schedules.e2e-spec.ts`

### Archivos modificados

- `apps/api/prisma/schema.prisma` — modelos nuevos + 4 relaciones inversas.
- `apps/api/src/app.module.ts` — registra `StaffSchedulesModule`.

### Comandos de prueba

**1. Crear bloque recurrente:**

```bash
curl -X POST http://localhost:3001/staff-schedules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"staffId":"<ID_STAFF>","dayOfWeek":1,"startTime":"09:00","endTime":"12:00"}'
```

**2. La prueba clave del solapamiento — un segundo bloque que se cruza con el anterior:**

```bash
curl -i -X POST http://localhost:3001/staff-schedules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"staffId":"<ID_STAFF>","dayOfWeek":1,"startTime":"11:00","endTime":"15:00"}'
```

Debe devolver **400**.

**3. Excepción contradictoria — `isAvailable: false` con horario:**

```bash
curl -i -X POST http://localhost:3001/staff-schedule-exceptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"staffId":"<ID_STAFF>","date":"2026-12-25","isAvailable":false,"startTime":"09:00","endTime":"12:00"}'
```

Debe devolver **400**.

**4. Excepción válida — día no disponible (feriado):**

```bash
curl -X POST http://localhost:3001/staff-schedule-exceptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"staffId":"<ID_STAFF>","date":"2026-12-25","isAvailable":false,"reason":"Navidad"}'
```

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **35 tests** en verde: 24 ya existentes + 11 nuevos de `staff-schedules`.

### Checklist del Paso 1 (Fase 5)

- [x] Las 3 migraciones (`add_staff_schedules`, `add_staff_schedule_time_constraints`, `enable_rls_staff_schedules`) se aplican sin error.
- [x] Crear un bloque recurrente → 201, respuesta con `startTime`/`endTime` como `"HH:mm"`.
- [x] Un segundo bloque que se solapa con el primero → 400.
- [x] Un bloque con `endTime` ≤ `startTime` → 400 (sin turnos overnight en v1).
- [x] Tenant B no puede crear horarios para staff de tenant A → 404.
- [x] Excepción `isAvailable: true` sin horario → 400.
- [x] Excepción `isAvailable: false` con horario → 400.
- [x] Excepción `isAvailable: false` sin horario (feriado) → 201, con `startTime`/`endTime` en `null`.
- [x] Segunda excepción para el mismo `staffId` + `date` → 409.
- [x] `npm run test:e2e` → 35/35 en verde.

### Lo que queda explícitamente pendiente para el siguiente paso de la Fase 5

- **`BranchSchedule`** (horario de apertura de la sucursal) — limitación conocida, no implementado todavía.
- **Cálculo real de disponibilidad** (`GET /availability`): combinar `StaffSchedule` + `StaffScheduleException` + `bookings` (que tampoco existe como modelo) contra una fecha concreta, resolviendo `branch.timezone` para convertir a instantes UTC reales. Es el paso donde por fin se usa una librería de timezones (`luxon` o `date-fns-tz`) — no antes.

## Paso 2 — Fixes del Paso 1 + `GET /availability`

### Fixes absorbidos primero

**PATCH de excepciones exigía `times` aunque no se tocaran.** `update()` revalidaba `isAvailable`/`startTime`/`endTime` incondicionalmente contra los valores crudos del DTO, así que un `PATCH { reason: "..." }` sobre una excepción `isAvailable: true` ya válida fallaba porque `dto.startTime`/`dto.endTime` venían `undefined`. Corregido: solo se revalida cuando el caller realmente toca `isAvailable` o algún horario, y la validación se resuelve contra los valores **existentes** de la fila (no solo lo que vino en el DTO) — así que actualizar solo `startTime` y dejar `endTime` como estaba también funciona correctamente ahora.

**`parseCalendarDate` ancla explícitamente a medianoche UTC.** El DTO usaba `@IsDateString()`, que acepta el grado completo de ISO-8601 — incluyendo un datetime con offset (`"2026-12-25T23:00:00-05:00"`), que no necesariamente cae en la medianoche UTC del día calendario que se quiso decir. Se reemplazó por `@Matches(/^\d{4}-\d{2}-\d{2}$/)` (solo fecha, nada de hora/offset) más una función dedicada `parseCalendarDate()` en `time.util.ts` que construye la fecha vía `Date.UTC(year, month-1, day)` explícitamente, en vez de confiar en el parsing genérico de `new Date(string)`.

### Diseño de `GET /availability`

**Esto NO es la disponibilidad final de reservas — es disponibilidad de horario únicamente.** Todavía no existe el modelo `Booking` (fase posterior), así que este endpoint no tiene forma de saber cuáles de estos slots "teóricamente libres" ya están tomados. Responde *"¿cuándo está programado para trabajar este empleado?"*, no todavía *"¿cuándo puedo reservar de verdad?"* — la segunda pregunta necesita esta misma lógica combinada con el exclusion constraint de `bookings` cuando ese modelo exista. Documentado así de explícito para que nadie lo confunda con el endpoint final del roadmap.

**Algoritmo, en orden:**

1. Resolver `staff` y `service` (ambos vía RLS) → 404 si cualquiera es invisible para el tenant del caller.
2. Confirmar que el staff está calificado para el servicio — existe una fila real en `StaffService` → si no, **400**, no 404 (es una violación de regla de negocio, no una cuestión de existencia/visibilidad — el staff y el servicio sí existen, simplemente no están vinculados).
3. Buscar una `StaffScheduleException` para `(staffId, date)`:
   - existe, `isAvailable: false` → sin slots, listo (día libre).
   - existe, `isAvailable: true` → su propio rango de horario **reemplaza** el horario recurrente para esa fecha (regla del Paso 1, ya confirmada).
   - no existe → usar las filas de `StaffSchedule` para ese día de la semana (puede haber más de un bloque).
4. Cada bloque de horario (hora local de pared) se resuelve contra `branch.timezone` **para la fecha calendario específica solicitada**, usando Luxon — este es el único lugar de toda la feature de horarios donde ocurre la conversión a UTC correcta respecto a horario de verano.
5. Cada bloque resuelto en UTC se corta en slots de `service.durationMinutes + service.bufferMinutes` — el mismo concepto de "duración efectiva" que el Technical Plan original definió para el futuro exclusion constraint de `bookings`, aplicado acá también para que un slot que devuelve este endpoint sea exactamente del tamaño que ocuparía una reserva real de ese servicio.

**Por qué Luxon y no cálculo manual de offsets:** los offsets de zona horaria cambian con las reglas de DST de cada país, y una tabla de offsets fija se desactualiza. Luxon (como `date-fns-tz`) usa la base de datos IANA de zonas horarias, que sabe resolver "9am en América/Bogotá el 14 de septiembre de 2026" al instante UTC correcto sin que nosotros tengamos que razonar sobre offsets a mano.

**Gap conocido, heredado del Paso 0:** sin `BranchSchedule`, este endpoint no valida que el horario de un staff caiga dentro del horario de apertura de su sucursal — sigue siendo la misma limitación ya declarada, no una nueva.

### Archivos nuevos

- `apps/api/src/availability/` completo: `availability.module.ts`, `availability.controller.ts`, `availability.service.ts`, `dto/get-availability-query.dto.ts`.
- `apps/api/test/availability.e2e-spec.ts`

### Archivos modificados

- `apps/api/src/staff-schedules/time.util.ts` — `parseCalendarDate`/`formatCalendarDate` nuevas.
- `apps/api/src/staff-schedules/dto/create-staff-schedule-exception.dto.ts` — `date` ahora usa `@Matches` estricto en vez de `@IsDateString()`.
- `apps/api/src/staff-schedules/staff-schedule-exceptions.service.ts` — fix del PATCH parcial + uso de `parseCalendarDate`/`formatCalendarDate`.
- `apps/api/src/app.module.ts` — registra `AvailabilityModule`.
- `apps/api/package.json` — nueva dependencia `luxon` + `@types/luxon`.

### Comandos de prueba

Sin migración nueva — `AvailabilityService` es de solo lectura sobre tablas que ya existen.

```bash
docker-compose up --build api
docker exec booking-api npm run seed
```

**1. Slots de un bloque de 2 horas partido en incrementos de 30 minutos:**

```bash
curl "http://localhost:3001/availability?staffId=<ID_STAFF>&serviceId=<ID_SERVICIO>&date=2026-09-14" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>"
```

**2. La prueba clave — confirmar que el offset de zona horaria es correcto:** revisa el campo `startUtc` del primer slot y confirma que corresponde a la hora local menos el offset real de `branch.timezone` (ej. `America/Bogota` es UTC-5 todo el año, sin DST — fácil de verificar a mano).

**3. Día con excepción `isAvailable: false` → `slots: []`.**

**4. Staff no calificado para el servicio → 400.**

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **41 tests** en verde: 34 ya existentes + 7 nuevos de `availability`.

### Checklist del Paso 2

- [x] `PATCH` de una excepción solo con `reason` (sin tocar `times`) ya no falla.
- [x] Bloque de 2 horas con slots de 30 min → exactamente 4 slots, límites correctos.
- [x] `startUtc` del primer slot coincide con la hora local convertida correctamente contra `branch.timezone`.
- [x] Excepción `isAvailable: false` → `slots: []`.
- [x] Excepción `isAvailable: true` → reemplaza el horario recurrente, no lo combina.
- [x] Staff no calificado para el servicio solicitado → 400.
- [x] Query params inválidos (ej. `staffId` no-UUID) → 400.
- [x] `npm run test:e2e` → 41/41 en verde.

### Lo que sigue, explícitamente fuera de este paso

- **`BranchSchedule`** — todavía pendiente.
- **`Booking` + exclusion constraint** — el modelo que finalmente convierte "disponibilidad de horario" en "disponibilidad de reserva real", combinando esta lógica con el mecanismo anti-double-booking ya diseñado en el Technical Plan original (Fase 0).

## Paso 3 — `BranchSchedule` + fixes de la verificación del Paso 2

### Fixes absorbidos primero (sin README subido — reconstruidos a partir de la descripción)

- **Timezone IANA validada de verdad.** `BranchesService.create/update` ahora rechaza con 400 cualquier `timezone` que no exista en la base IANA (`IANAZone.isValidZone(...)`, de Luxon — mismo mecanismo que ya usa `AvailabilityService`). Antes, un typo como `"America/Bogotta"` se guardaba sin problema y solo explotaba mucho después, dentro de Luxon, en un lugar lejano de donde se cargó el dato malo.
- **Defensa en profundidad: `staff.branchId === service.branchId` en `AvailabilityService`.** Esto cierra directamente el gap que yo mismo había dejado anotado en la Fase 4: reasignar un `Staff` a otra sucursal no invalida sus `StaffService` viejos. Ahora, aunque esa fila de calificación exista, si el staff ya no está en la misma sucursal que el servicio, el endpoint de disponibilidad lo rechaza con 400 en vez de devolver slots que no deberían existir.
- **Test de regresión del PATCH parcial de excepciones** (solo `reason`, sin tocar `isAvailable`/`times`) — agregado a `staff-schedules.e2e-spec.ts`, confirma que el fix del paso anterior no se rompe silenciosamente en el futuro.

### Diseño de `BranchSchedule` — la decisión que more importa: compatibilidad retroactiva

**El problema:** activar la restricción de horario de sucursal de forma estricta ("sin `BranchSchedule` configurado = cerrado") habría roto instantáneamente los 41 tests que ya pasaban — ninguna sucursal de los pasos anteriores configura horario de apertura.

**La decisión: modelo opt-in.** Si una sucursal **no tiene ninguna fila de `BranchSchedule`** (en ningún día de la semana), el sistema no aplica ninguna restricción — se comporta exactamente como antes de este paso. En el momento en que el tenant admin configura **al menos un día**, la sucursal queda "opt-in": a partir de ahí, cualquier día de la semana sin fila configurada se considera cerrado (mismo criterio que ya usa `StaffSchedule` para el staff — la ausencia de horario ese día significa que no trabaja, no "trabaja todo el día por defecto"). Es la misma filosofía aplicada consistentemente: la ausencia de configuración nunca es una restricción silenciosa, pero una vez que empezás a configurar, el sistema te toma la palabra.

**Reglas de `BranchScheduleException`** — idénticas a `StaffScheduleException`, con `isOpen` en vez de `isAvailable` (más preciso semánticamente para una sucursal física que para una persona): reemplaza el horario recurrente ese día, `isOpen: true` exige horario, `isOpen: false` lo prohíbe, sin turnos overnight.

**Algoritmo de intersección:** una vez resueltos los bloques de horario del staff (igual que en el Paso 2) y los bloques de apertura de la sucursal (mismo mecanismo, nueva tabla), el resultado final es la **intersección** de ambos conjuntos — un slot solo existe donde el staff está programado para trabajar **y** la sucursal está abierta al mismo tiempo. Con múltiples bloques de cada lado (ej. staff con turno mañana+tarde, sucursal con horario partido por almuerzo), se intersecta cada bloque de staff contra cada bloque de sucursal, quedándose solo con los solapamientos válidos.

**Respuesta de `GET /availability` gana un campo nuevo: `branchScheduleApplied`** — booleano explícito que indica si la sucursal tiene horario configurado y por lo tanto restringió los resultados, o si el cálculo fue solo sobre el horario del staff (sin restricción de sucursal). Transparencia sobre cuál de los dos modos aplicó, útil tanto para debugging como para que el frontend eventualmente pueda mostrar "esta sucursal no tiene horario configurado todavía".

### Modelos Prisma

```prisma
model BranchSchedule {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  branchId String @map("branch_id")
  branch   Branch @relation(fields: [branchId], references: [id])

  dayOfWeek Int @map("day_of_week")

  startTime DateTime @map("start_time") @db.Time()
  endTime   DateTime @map("end_time") @db.Time()

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@index([branchId, dayOfWeek])
  @@map("branch_schedules")
}

model BranchScheduleException {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  branchId String @map("branch_id")
  branch   Branch @relation(fields: [branchId], references: [id])

  date      DateTime @db.Date
  isOpen    Boolean  @map("is_open")
  startTime DateTime? @map("start_time") @db.Time()
  endTime   DateTime? @map("end_time") @db.Time()
  reason    String?

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([branchId, date])
  @@index([tenantId])
  @@map("branch_schedule_exceptions")
}
```

Relaciones inversas: `Tenant.branchSchedules`, `Tenant.branchScheduleExceptions`, `Branch.schedules`, `Branch.scheduleExceptions` — 18 relaciones en total en el schema, auditadas cruzado (18 `@relation` vs 18 campos inversos) antes de generar la migración.

**Refactor de paso: `time.util.ts` se movió a `src/common/util/`** — ya lo usan dos módulos (`staff-schedules` y `branch-schedules`), mismo criterio que `@TenantScoped()` cuando llegó su segundo consumidor.

### Migraciones

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --name add_branch_schedules

docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name add_branch_schedule_time_constraints
```

Pegar en el archivo generado por el segundo comando:

```sql
ALTER TABLE branch_schedules
  ADD CONSTRAINT branch_schedules_time_order CHECK (end_time > start_time);

ALTER TABLE branch_schedule_exceptions
  ADD CONSTRAINT branch_schedule_exceptions_time_order
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name enable_rls_branch_schedules
```

Pegar en el archivo generado por el tercer comando:

```sql
ALTER TABLE branch_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branch_schedules
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );

ALTER TABLE branch_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_schedule_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branch_schedule_exceptions
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy

docker exec booking-api npx prisma generate
docker-compose restart api
```

Sin `GRANT` manual — cubierto por `ALTER DEFAULT PRIVILEGES`.

### Archivos nuevos

- `apps/api/src/branch-schedules/` completo: `branch-schedules.module.ts`, `branch-schedules.controller.ts`, `branch-schedules.service.ts`, `branch-schedule-exceptions.controller.ts`, `branch-schedule-exceptions.service.ts`, `dto/` (4 archivos).
- `apps/api/src/common/util/time.util.ts` (movido desde `staff-schedules/`).
- `apps/api/test/branch-schedules.e2e-spec.ts`

### Archivos modificados

- `apps/api/prisma/schema.prisma` — modelos `BranchSchedule`/`BranchScheduleException` + relaciones inversas.
- `apps/api/src/availability/availability.service.ts` — reescrito para resolver e intersectar bloques de staff y sucursal; nuevo campo `branchScheduleApplied`.
- `apps/api/src/branches/branches.service.ts` — validación de timezone IANA.
- `apps/api/src/staff-schedules/*.service.ts` — imports actualizados tras el move de `time.util.ts`.
- `apps/api/test/staff-schedules.e2e-spec.ts` — test de regresión del PATCH parcial.
- `apps/api/src/app.module.ts` — registra `BranchSchedulesModule`.

### Comandos de prueba

```bash
docker-compose up --build api
docker exec booking-api npm run seed
```

**1. Sin `BranchSchedule` configurado — debe seguir funcionando exactamente igual que en el Paso 2:**

```bash
curl "http://localhost:3001/availability?staffId=<ID_STAFF>&serviceId=<ID_SERVICIO>&date=2026-09-14" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>"
```

`branchScheduleApplied` debe ser `false`.

**2. Configurar horario de sucursal más angosto que el del staff — la prueba clave de intersección:**

```bash
curl -X POST http://localhost:3001/branch-schedules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"branchId":"<ID_SUCURSAL>","dayOfWeek":1,"startTime":"10:00","endTime":"11:00"}'
```

Repetir la consulta de disponibilidad — los slots ahora deben quedar acotados a `10:00-11:00`, no al rango completo del staff.

**3. Timezone inválida al crear sucursal → 400:**

```bash
curl -i -X POST http://localhost:3001/branches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN_TENANT_A>" \
  -d '{"name":"Test","timezone":"Not/AZone"}'
```

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **49 tests** en verde: 41 ya existentes + 1 test de regresión del PATCH parcial + 6 nuevos de `branch-schedules` + 1 test nuevo que agregué para ejercitar específicamente la defensa en profundidad `staff.branchId !== service.branchId` (el test anterior de "no calificado" no llegaba a probar ese camino — pasaba por el chequeo de `StaffService` antes de siquiera llegar ahí).

### Checklist del Paso 3

- [x] Las 3 migraciones nuevas (`add_branch_schedules`, `add_branch_schedule_time_constraints`, `enable_rls_branch_schedules`) se aplican sin error.
- [x] Timezone inválida en `POST /branches` → 400.
- [x] Sucursal sin `BranchSchedule` → `branchScheduleApplied: false`, comportamiento idéntico al Paso 2.
- [x] Sucursal con horario más angosto que el del staff → slots recortados a la intersección real.
- [x] Día de la semana sin fila configurada, una vez que la sucursal ya está "opt-in" → 0 slots.
- [x] `BranchScheduleException isOpen: false` → 0 slots ese día, aunque el horario recurrente lo permitiría.
- [x] Bloques de `BranchSchedule` que se solapan el mismo día → 400.
- [x] `staff.branchId !== service.branchId` (defensa en profundidad) → 400 en `/availability`, ejercitado específicamente moviendo un staff a otra sucursal después de calificarlo para un servicio (reproduce el gap real de la Fase 4).
- [x] `npm run test:e2e` → 49/49 en verde.

### Fase 5 — cierre

Con `StaffSchedule`, `StaffScheduleException`, `BranchSchedule`, `BranchScheduleException` y `GET /availability` completos, el gap de la sucursal queda cerrado. Lo único que falta para que `/availability` sea el endpoint final del roadmap es el modelo `Booking` con su exclusion constraint — momento en el que esta misma lógica de intersección se combina con "¿cuáles de estos slots ya están reservados?" para dar la disponibilidad real de reservas.

---

# Fase 6: Bookings — Bitácora

## Diseño

- `startTime`/`endTime` son columnas `@db.Timestamptz` normales (Prisma no modela `tstzrange`); el exclusion constraint calcula `tstzrange(start_time, end_time)` en la migración cruda, no en el schema.
- `endTime` siempre se calcula server-side (`service.durationMinutes + service.bufferMinutes`), nunca se acepta del cliente — así el buffer queda incluido en el rango bloqueado sin lógica extra.
- El exclusion constraint cubre `PENDING` y `CONFIRMED` (aprobado desde el inicio del proyecto): un checkout en curso ya bloquea el slot.
- `PENDING` expira vía sweep periódico (`BookingsCleanupService`, cron cada minuto, TTL 10 min) — no BullMQ, decisión ya aprobada: es un `UPDATE` masivo idéntico en cada corrida, no justifica una cola.
- Error `P2004` de Prisma (constraint violado) se traduce a `409 Conflict` — la app nunca decide si hay conflicto, solo interpreta lo que PostgreSQL ya decidió.
- `CLIENT` solo puede reservar/cancelar para sí mismo; `TENANT_ADMIN`/`STAFF` pueden reservar en nombre de un cliente y cancelar cualquier reserva del tenant.

## Schema + migraciones

Modelo completo y las 23 relaciones bidireccionales están en `apps/api/prisma/schema.prisma` (enum `BookingStatus`, modelo `Booking`).

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --name add_bookings

docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name add_bookings_constraints
```

Pegar en el archivo generado:

```sql
ALTER TABLE bookings
  ADD CONSTRAINT bookings_time_order CHECK (end_time > start_time);

-- btree_gist ya está habilitada desde la Fase 1 (docker/postgres/init.sql)
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED'));
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate dev --create-only --name enable_rls_bookings
```

Pegar en el archivo generado:

```sql
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bookings
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  );
```

```bash
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy

docker exec booking-api npx prisma generate
docker-compose down -v
docker-compose up --build api
```

Sin `GRANT` manual — `ALTER DEFAULT PRIVILEGES` cubre la tabla nueva.

## Archivos nuevos

- `apps/api/src/bookings/` completo: `bookings.module.ts`, `bookings.controller.ts`, `bookings.service.ts`, `bookings-cleanup.service.ts`, `dto/create-booking.dto.ts`.
- `apps/api/test/bookings.e2e-spec.ts`

## Archivos modificados

- `apps/api/prisma/schema.prisma` — enum `BookingStatus`, modelo `Booking`, relaciones inversas en `Tenant`/`Branch`/`Staff`/`Service`/`User`.
- `apps/api/src/app.module.ts` — `ScheduleModule.forRoot()` + `BookingsModule`.
- `apps/api/package.json` — nueva dependencia `@nestjs/schedule`.

## Comandos de prueba

```bash
docker exec booking-api npm run seed
docker exec booking-api npm run test:e2e
```

Debe correr **56 tests** en verde: 48 ya existentes + 8 nuevos de `bookings`.

**El test que más importa revisar manualmente:** `"THE critical test"` — dos requests HTTP reales en paralelo (`Promise.all`, no secuenciales) contra el mismo slot exacto. Exactamente uno debe devolver 201 y el otro 409. Es la prueba real, bajo concurrencia de verdad, de todo lo que se diseñó desde la Fase 0.

## Checklist

- [x] Las 3 migraciones (`add_bookings`, `add_bookings_constraints`, `enable_rls_bookings`) se aplican sin error.
- [x] Crear reserva → `PENDING`, `endTime` incluye el buffer.
- [x] Reserva solapada → 409, no 500.
- [x] **Dos requests en paralelo por el mismo slot → exactamente un 201 y un 409.**
- [x] Servicio de otra sucursal que la del staff → 400.
- [x] `confirm` → `CONFIRMED`; un slot `CONFIRMED` sigue bloqueando (constraint cubre ambos estados).
- [x] Cancelar libera el slot para una nueva reserva.
- [x] `npm run test:e2e` → 56/56 en verde.

## Integración Disponibilidad ↔ Reservas

**Fixes absorbidos primero:**
- Mapeo de error corregido: `23P01` (exclusion_violation) no llega como `P2004` de Prisma — llega como `PrismaClientUnknownRequestError` con el texto crudo del driver en `.message`. `translateDatabaseError` ahora detecta por nombre de constraint/SQLSTATE en el mensaje, no por `err.code`.
- `findAll`/`findOne`/`cancel` ahora reciben `user` y fuerzan `clientId = user.id` cuando el rol es `CLIENT` — antes un cliente podía listar reservas de todo el tenant.

**`AvailabilityService`:** después de calcular los slots candidatos (staff ∩ branch), se restan las reservas `PENDING`/`CONFIRMED` existentes del mismo staff — de cualquier servicio, no solo el consultado, porque el exclusion constraint bloquea por `staff_id`, sin importar el servicio. `GET /availability` ahora es disponibilidad real, no solo de horario.

**`BookingsService.create`:** antes de intentar el insert, llama internamente a `AvailabilityService.getSlots` (mismo cálculo, una sola fuente de verdad) y exige `startTime` exacto igual a algún `startUtc` devuelto → si no, `400`. El exclusion constraint sigue siendo la última línea de defensa real contra condiciones de carrera (dos requests simultáneos ven el mismo slot "disponible" antes de que cualquiera confirme) — este chequeo nuevo solo convierte un request obviamente inválido en un `400` limpio en vez de depender del constraint para todo.

### Archivos modificados

- `apps/api/src/availability/availability.service.ts` — resta reservas existentes.
- `apps/api/src/availability/availability.module.ts` — exporta `AvailabilityService`.
- `apps/api/src/bookings/bookings.service.ts` — valida slot contra disponibilidad; fix de mapeo de error; fix de aislamiento de `clientId`.
- `apps/api/src/bookings/bookings.controller.ts` — pasa `user` a `findAll`/`findOne`.
- `apps/api/src/bookings/bookings.module.ts` — importa `AvailabilityModule`.
- `apps/api/test/bookings.e2e-spec.ts` — reescrito con horarios alineados a la grilla real de slots (40 min: duración 30 + buffer 10) + test de aislamiento de `CLIENT`.

### Comandos

```bash
docker exec booking-api npm run test:e2e
```

Debe correr **58 tests**: los de `bookings` pasan de 8 a 10 (uno nuevo de rechazo por slot no alineado, uno de aislamiento de `CLIENT`); los demás módulos sin cambios.

### Checklist

- [x] `GET /availability` ya no incluye slots ocupados por reservas `PENDING`/`CONFIRMED`.
- [x] `POST /bookings` con horario no alineado a la grilla → 400, antes de tocar la base de datos.
- [x] Segunda solicitud secuencial (no concurrente) para un slot ya reservado → 400 (vía disponibilidad), no 409.
- [x] Dos requests simultáneos por el mismo slot → sigue siendo 201+409 (la carrera real solo se resuelve en el constraint).
- [x] Un `CLIENT` no ve reservas de otro `CLIENT` del mismo tenant en `GET /bookings`.
- [x] `npm run test:e2e` → 58/58 en verde.

**Fix posterior — estabilización anti-TOCTOU:** `BookingsService.create` ahora llama a `getSlots(..., { ignoreBookings: true })` — el chequeo de escritura valida solo contra la grilla de horario (staff ∩ branch), nunca contra reservas existentes. Detectar double-booking es trabajo exclusivo del exclusion constraint; mezclarlo en el pre-check hacía el resultado depender del timing de visibilidad transaccional entre el chequeo y el insert. `GET /availability` (lectura, sin este flag) sigue restando reservas reales — el split es intencional: la escritura necesita determinismo, la lectura necesita UX.

---

# Fase 7: Frontend — Bitácora

## Evaluación del roadmap

Roadmap original: Fase 7 = Frontend (Redis/Testing/AWS/CI-CD/IA/Hardening vienen después). Pagos y Notificaciones **no estaban en el plan original** — extensiones válidas a futuro, pero no "lo siguiente". Con el backend resolviendo ya el problema difícil (RLS + anti-double-booking probado bajo concurrencia real), lo que falta para que el proyecto sea demostrable es una pantalla que lo use — no más features de backend.

## Paso 1 — Cliente de API + Auth + Dashboard protegido

- `lib/api-client.ts` — fetch wrapper con Bearer token + retry automático una vez en 401 vía `/auth/refresh` (reusa la rotación de la Fase 2).
- `lib/auth-context.tsx` — contexto React (`AuthProvider`/`useAuth`), tokens en `localStorage`, `login`/`logout`.
- `app/login/page.tsx` — formulario email/password/`tenantSlug` (vacío = super admin, mismo contrato de `POST /auth/login` desde la Fase 3).
- `app/dashboard/page.tsx` — protegida (redirige a `/login` si no autenticado), hace `GET /branches` real contra la API — primera pantalla que prueba el stack completo end-to-end.
- `app/page.tsx` — ahora redirige a `/login` (reemplaza el health-check de conectividad Docker de la Fase 1; esa verificación la sigue haciendo el dashboard, mejor, porque además es útil).

## Comandos

```bash
docker-compose up --build web api
```

Abrir `http://localhost:3000` → redirige a `/login` → login con `admin@tenant.dev` / `ChangeMe123!` / `tenant-a` → `/dashboard` con las sucursales reales del tenant.

## Checklist

- [x] `http://localhost:3000` redirige a `/login`.
- [x] Login con credenciales inválidas muestra el error de la API.
- [x] Login válido redirige a `/dashboard` y lista sucursales reales.
- [x] Recargar `/dashboard` mantiene la sesión (tokens persistidos).
- [x] "Cerrar sesión" limpia tokens y vuelve a `/login`.
- [x] Acceder a `/dashboard` sin sesión redirige a `/login`.

## Siguiente paso propuesto

Flujo de reserva real: página de sucursal → servicios → `GET /availability` → selección de slot → `POST /bookings`. Es el frontend consumiendo exactamente la cadena que se construyó en las Fases 4-6.

## Paso 2 — Flujo de reserva completo

**Fix absorbido:** `docker-compose.yml` — eliminado el volumen anónimo `/app/.next` (causaba cache stale del App Router, rutas nuevas devolvían 404 hasta rebuild completo).

**`app/book/page.tsx`** — wizard de 5 pasos en un solo componente con estado local (`Step = 'branch' | 'service' | 'staff' | 'slot' | 'confirm' | 'done'`):

1. `GET /branches` → elegir sucursal.
2. `GET /services?branchId=` → elegir servicio.
3. `GET /staff?branchId=` → filtrado client-side a los calificados para el servicio (mismo join `StaffService` que ya valida el backend — el filtro acá es UX, no seguridad; la API revalida igual).
4. `GET /availability?staffId&serviceId&date` → grilla de slots reales (ya con reservas restadas desde el Paso 2 de la Fase 6).
5. Confirmar → `POST /bookings`.

**Manejo de la respuesta de `POST /bookings`:**
- `201` → muestra la reserva creada, estado `PENDING`.
- `409` → mensaje claro ("alguien más tomó ese horario") + limpia el slot seleccionado + **refresca `GET /availability` automáticamente**, para que el slot ya tomado desaparezca de la grilla en vez de dejar al usuario en un callejón sin salida.
- otro error → muestra `body.message` de la API tal cual.

**Fuera de alcance de este paso, dicho explícitamente:** no hay selector de "reservar para otro cliente" (`TENANT_ADMIN`/`STAFF` en nombre de un `CLIENT`) — no existe todavía un endpoint para listar usuarios `CLIENT` del tenant. El flujo asume que quien reserva lo hace para sí mismo (`clientId` lo resuelve el backend del JWT).

### Archivos nuevos

- `apps/web/lib/types.ts` — tipos compartidos (`Branch`, `Service`, `Staff`, `AvailabilityResponse`, `Booking`).
- `apps/web/app/book/page.tsx`

### Archivos modificados

- `docker-compose.yml` — fix del volumen `.next`.
- `apps/web/app/dashboard/page.tsx` — link a `/book`.

### Comandos

```bash
docker-compose down -v
docker-compose up --build web api
# Obligatorio tras -v (volumen postgres nuevo):
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy
docker exec booking-api npm run seed
docker exec booking-api npm run test:e2e
```

`http://localhost:3000/book` (con sesión iniciada) → completar el wizard.

**Prueba del 409 en vivo:** abrir `/book` en dos pestañas, avanzar ambas hasta el mismo slot, confirmar casi simultáneamente en las dos — una debe mostrar la reserva creada, la otra el mensaje de conflicto con la grilla ya refrescada.

### Checklist

- [x] Las rutas nuevas (`/book`) cargan sin 404 tras `docker-compose up --build` (confirma el fix del volumen).
- [x] Wizard completo: sucursal → servicio → staff calificado → slot real → confirmación → `201`.
- [x] Slot tomado por otra pestaña entre selección y confirmación → mensaje de conflicto, grilla refrescada, sin crash.
- [x] Sucursal/servicio/día sin datos → mensajes vacíos claros, no pantallas rotas.
- [x] e2e API tras `down -v` + migrate + seed → **57/57**.

### Verificación (este entorno)

- Tras `docker-compose down -v`, hace falta `prisma migrate deploy` (como `booking_admin`) **antes** del seed; el README de comandos del Paso 2 no lo listaba.
- `.env` tenía `DATABASE_URL` con password de `booking_app` incorrecta (`change_me_local_only` vs `change_me_local_only_app` de `init.sql` / `.env.example`) — tras wipe el rol se recrea limpio y la API no arrancaba hasta alinear `.env`.
- Carrera API concurrente mismo slot → **201 + 409**; `GET /availability` omite el slot tomado.
- UI: wizard `/book` OK; empty branch → "Esta sucursal no tiene servicios todavía."; 201 → "Reserva creada — estado: PENDING".
- **Fix UI aplicado:** `loadAvailability` ya no hace `setError(null)` — antes el refresh post-409 borraba el mensaje de conflicto en el mismo tick.

---

# Fase 8: Redis + Rate Limiting — Bitácora

## Diseño

- **NO Redis para prevenir double-booking** — sigue siendo trabajo exclusivo del exclusion constraint (decisión de la Fase 0). Acá Redis es cache-aside puro sobre `GET /availability`.
- **Cache key por tenant+staff+día, no por servicio.** El conjunto de reservas ocupadas de un staff en un día es independiente del servicio consultado — una sola entrada de cache sirve cualquier `serviceId` que se pregunte ese día. `bookingsCacheKey()` se exporta desde `AvailabilityService` para que `BookingsService`/`BookingsCleanupService` invaliden exactamente la misma key, nunca una reconstruida a mano.
- **TTL corto (30s) como red de seguridad, no como mecanismo real.** La consistencia real es invalidación explícita en `create`/`confirm`/`cancel` y en el sweep de TTL de `PENDING` — el TTL solo acota el daño si alguna invalidación se olvida.
- **Redis nunca puede fallar una request.** `RedisService.getJson/setJson/del` atrapan cualquier error y degradan a cache-miss — una caída de Redis nunca debe tumbar disponibilidad o reservas, solo el rendimiento.
- **Rate limiting** (`@nestjs/throttler`): default global 100 req/60s por IP; `POST /auth/login` sobreescribe a 5/60s (fuerza bruta).
- **Ya existían en el repo** (no los escribí yo esta vez, los auditè y quedaron consistentes): `CorrelationIdMiddleware` (X-Request-Id) + `AllExceptionsFilter` (respuesta de error estructurada, log con correlationId) — cumplen el requisito de Observabilidad del Technical Plan original.

## Archivos nuevos

- `apps/api/src/redis/redis.module.ts`, `redis.service.ts`
- `apps/api/test/caching-and-rate-limiting.e2e-spec.ts`

## Archivos modificados

- `apps/api/src/availability/availability.service.ts` — cache-aside sobre la resta de reservas; exporta `bookingsCacheKey`.
- `apps/api/src/bookings/bookings.service.ts` — invalida cache en `create`/`confirm`/`cancel`.
- `apps/api/src/bookings/bookings-cleanup.service.ts` — invalida cache al expirar `PENDING` stale.
- `apps/api/src/app.module.ts` — registra `RedisModule` (faltaba, aunque `ThrottlerModule` ya estaba configurado).
- `apps/api/package.json` — `ioredis`, `@nestjs/throttler` (fix: había quedado duplicado en dos versiones al mezclar mi edición con la ya existente — resuelto a `^5.1.2`).

## Comandos

```bash
docker-compose down -v
docker-compose up --build api web
docker exec -e DATABASE_URL="postgresql://booking_admin:change_me_local_only@postgres:5432/booking_saas?schema=public" \
  booking-api npx prisma migrate deploy
docker exec booking-api npm run seed
docker exec booking-api npm run test:e2e
```

Debe correr **59 tests**: 57 previos (Fases 3–7) + 2 de Fase 8 (invalidación de cache — ahora también cubre cancel → slot reaparece — + rate limiting 429). La bitácora original decía "58+2=60"; el conteo real del repo es **59**.

## Checklist

- [x] `GET /availability` responde igual con Redis caído (degrada a cache-miss, no rompe).
- [x] Crear una reserva → el slot desaparece de `GET /availability` en la siguiente lectura, no en 30s.
- [x] Cancelar una reserva → el slot reaparece de inmediato.
- [x] 6 intentos de login fallidos seguidos → el 6to responde `429`.
- [x] `npm run test:e2e` → **59/59** en verde.
- [x] `@nestjs/throttler` aparece una sola vez en `package.json` (`^5.1.2` → instalado `5.2.0`); `ioredis` presente.

### Verificación / fixes (este entorno)

1. **Rate-limit e2e flaky/falso negativo:** el `beforeAll` hacía un `POST /auth/login` exitoso (cuenta 1/5 del `@Throttle` de login) y luego 6 fallidos → el 5º fallo ya era `429`. Se aisló el test de rate limiting en un `describe` con Nest app propia **sin** login previo.
2. **Degradación Redis → 500:** `getJson` atrapaba el error, pero ioredis con cola offline + `connectTimeout` ~10s colgaba **dentro** de la transacción Prisma del `TenantContextInterceptor` (timeout 10s) → `Transaction already closed` 500. Fix en `RedisService`: `enableOfflineQueue: false`, `connectTimeout: 300ms`, y `Promise.race` budget 300ms en get/set/del.
3. Cache key confirmada en Redis: `avail:bookings:{tenantId}:{staffId}:{yyyy-MM-dd}` (TTL 30s).

---

# Fase 9: Testing (unit/coverage) — Bitácora

## Estrategia — qué se testea con unit, qué no

**Con unit tests (rápidos, sin Docker, sin DB):**
- Funciones puras (`time.util.ts`) — la base de todo el cálculo de horarios/timezones. Alto valor: un bug acá se propaga a `StaffSchedule`, `BranchSchedule`, `Availability` y `Bookings` a la vez.
- Guards (`TenantGuard`, `RolesGuard`) — lógica de autorización aislable con un `ExecutionContext` mockeado, sin necesidad de bootstrapear la app completa.
- `BookingsService.translateDatabaseError` — regresión directa del bug real de mapeo `23P01`/`P2004` encontrado en la Fase 6/8. Sin este test, un refactor futuro que vuelva a confiar en `err.code` rompería el `409` en silencio — ningún e2e no-racing lo detectaría, porque en el camino feliz nunca se dispara el constraint.

**Sin unit tests, cubierto ya por e2e (no vale la pena duplicar):**
- Servicios que son básicamente CRUD sobre Prisma (`BranchesService`, `ServicesService`) — mockear Prisma para probar "llama a `create` con estos argumentos" no prueba nada que el e2e no pruebe ya de forma más realista.
- RLS, aislamiento multi-tenant, el exclusion constraint real — necesitan Postgres de verdad, no tiene sentido mockearlos.
- El algoritmo completo de `AvailabilityService.getSlots` (intersección + cache) — depende de Prisma y Redis reales de forma tan central que un mock terminaría probando el mock, no la lógica; ya está cubierto por 7+ tests e2e específicos.

## Archivos nuevos

- `apps/api/jest.config.json` — config de Jest para unit tests (`*.spec.ts`, separado de `test/jest-e2e.json`).
- `apps/api/src/common/util/time.util.spec.ts` — 11 tests (no 10).
- `apps/api/src/auth/guards/tenant.guard.spec.ts` — 4 tests.
- `apps/api/src/auth/guards/roles.guard.spec.ts` — 5 tests.
- `apps/api/src/bookings/bookings.service.spec.ts` — 5 tests.

## Archivos modificados

- `apps/api/package.json` — `"test"` → `jest.config.json`; `"test:cov"` nuevo.
- `apps/api/src/common/util/time.util.ts` — exporta `intersectTimeRanges` (gap Fase 9).
- `apps/api/src/availability/availability.service.ts` — `intersectBlocks` delega a `intersectTimeRanges` (sin duplicar la lógica).

## Comandos

```bash
docker exec booking-api npm run test        # unit — 25/25, sin DB
docker exec booking-api npm run test:cov    # coverage en apps/api/coverage/
docker exec booking-api npm run test:e2e    # e2e — 59/59
```

## Checklist

- [x] `npm run test` → **25/25** unit (conteo real: 11+4+5+5; la bitácora original decía 24).
- [x] `npm run test:cov` genera reporte en `apps/api/coverage/` (`time.util.ts` ~100% stmts/lines; `coverage/` en `.gitignore`).
- [x] `npm run test:e2e` → **59/59**.
- [x] Gap `intersectTimeRanges` cerrado: exportado en `time.util` + usado por `AvailabilityService.intersectBlocks`.
- [x] Regresión `translateDatabaseError` (constraint name / `23P01` → `ConflictException`).

## Numeración siguientes fases (acordado)

| Fase | Tema | Por qué ese orden |
|------|------|-------------------|
| **10** | **CI/CD** (lint + `test` + `test:e2e` en jobs separados) | Cada cambio (incluido el de AWS) llega con red de seguridad automática |
| **11** | **AWS** (Docker prod, ECR/ECS, RDS roles) | Deploy manual sin pipeline no escala; CI primero |

## Bloqueo CI e2e — migraciones (respuesta al gap de Claude)

**En este repo las migraciones SÍ están completas.** `apps/api/prisma/migrations/` tiene **18** carpetas (`migration.sql` cada una), no solo `init`:

`init` → `add_tenant_model` → `enable_rls_users` → `add_branches` → `enable_rls_branches` → `add_services` → `enable_rls_services` → `add_staff` → `enable_rls_staff_module` → `add_staff_schedules` → `add_staff_schedule_time_constraints` → `enable_rls_staff_schedules` → `add_branch_schedules` → `add_branch_schedule_time_constraints` → `enable_rls_branch_schedules` → `add_bookings` → `add_bookings_constraints` → `enable_rls_bookings`.

Si la copia local de Claude solo ve `init`, el zip que recibió estaba incompleto — **no inventar SQL**. Enviar el proyecto entero (o al menos `apps/api/prisma/migrations/` + `migration_lock.toml` + `schema.prisma`). Con eso `prisma migrate deploy` en CI es viable de verdad.

Mientras tanto: el job de **lint + unit** (`npm run test`) puede armarse ya — no necesita Postgres.

---

# Fase 10: CI/CD — Bitácora

## Diseño

`.github/workflows/ci.yml`, 2 jobs:

1. **`lint-and-unit`** — sin infraestructura externa. `npm ci` → `lint` → `test` (unit) → `build`. ~1-2 min; atrapa la mayoría de los errores antes de que arranque el job lento.
2. **`e2e`** — `needs: lint-and-unit` (no tiene sentido levantar Postgres+Redis si el job rápido ya falló). Servicios `postgres:16-alpine` + `redis:7-alpine` como GitHub Actions `services`. Pasos: instalar `postgresql-client` → aplicar `docker/postgres/init.sql` (crea `booking_app`, habilita `btree_gist`, `ALTER DEFAULT PRIVILEGES`) → `prisma migrate deploy` con las 18 migraciones reales → `prisma generate` → `seed` → `test:e2e`.

**Mismo patrón `DATABASE_URL`/`DATABASE_MIGRATE_URL`** que ya usan en local: el job corre las migraciones como `booking_admin` (owner) y el resto como `booking_app` (no-superuser, sujeto a RLS) — ninguna variable nueva, exactamente la convención ya establecida desde el fix de la Fase 5.

## Bloqueos encontrados y resueltos en verificación

1. **`package-lock.json` desactualizado** — no incluía `ioredis` ni `@nestjs/throttler` (Fase 8). `npm ci` habría fallado en ambos jobs.
   - **Fix:** `docker exec booking-api npm install` → lock regenerado y verificado (`ioredis@5.11.1`, `@nestjs/throttler@5.2.0`).
2. **`npm run lint` sin configuración** — el script existía pero no había `.eslintrc.*` ni parser TS → CI fallaría en el primer step de lint.
   - **Fix:** `apps/api/.eslintrc.js` + `@typescript-eslint/parser` / `eslint-plugin` (devDeps). `npm run lint` → exit 0.

## Archivos nuevos / tocados

- `.github/workflows/ci.yml`
- `apps/api/package-lock.json` — regenerado (Fase 8 + eslint TS)
- `apps/api/.eslintrc.js`
- `apps/api/package.json` — devDeps `@typescript-eslint/*`

## Comandos para probar localmente antes de pushear (simula lo que hace CI)

```bash
docker exec booking-api npm ci
docker exec booking-api npm run lint
docker exec booking-api npm run test
docker exec booking-api npm run build
# e2e (equiv. al job lento; usa Postgres/Redis del compose local):
docker exec booking-api npm run test:e2e
```

## Checklist

- [x] `apps/api/package-lock.json` regenerado (incluye `ioredis`, `@nestjs/throttler`) — verificado con `npm ci` OK.
- [x] `npm run lint` / `test` (25/25) / `build` / `test:e2e` (59/59) verdes en local (simulación del pipeline).
- [x] `.eslintrc.js` presente para que el step `lint` de CI no falle por config ausente.
- [x] Push a una rama → el job `lint-and-unit` corre y pasa en GitHub Actions (CI #2, commit `2f18c07`, ~2m 12s).
- [x] El job `e2e` arranca después (`needs`), levanta Postgres+Redis, aplica las 18 migraciones, corre el seed, y el suite completo pasa en el runner de GitHub.
- [ ] Un PR con un test roto a propósito hace fallar el job correspondiente y bloquea el merge (branch protection — config de repo, no de código).

Cuando el push esté verde en GitHub, seguimos con la **Fase 11** (imágenes de producción + demo pública gratuita para portfolio + diseño AWS documentado; AWS real queda bloqueado hasta tener cuenta/créditos).

---

# Fase 11: Producción / Portfolio — Bitácora

## Por qué se reformuló (no es "AWS gratis")

El objetivo de esta fase, **sin empleo y sin tarjeta para AWS**, es doble y honesto:

1. **Demo en vivo** que un reclutador pueda abrir, loguearse y reservar — sin que tú pagues cloud enterprise.
2. **Artefactos profesionales** (Dockerfiles multi-stage, CI, diseño AWS / IaC) que demuestren que sabes cómo se desplegaría en un entorno tipo Fargate+RDS, **sin fingir** que Vercel/Render "son" ECS/RDS.

**AWS Free Tier y LocalStack Hobby no resuelven esto hoy:** AWS exige tarjeta aunque diga free; LocalStack Hobby **no** incluye RDS / ElastiCache / ECR / ECS / ALB (esos van en planes de pago o Student Pack). Por eso la Fase 11 se parte en **tres tracks**, no en "desplegar AWS a 0 USD".

| Track | Qué es | Costo | Para el reclutador |
|-------|--------|-------|--------------------|
| **11-A Artefactos** | Dockerfiles prod + job `docker-build` en CI | $0 | "Sé construir imágenes lean listas para contenedores" |
| **11-B Demo live** | Frontend + API + Postgres + Redis en free tiers | $0* | Link en el README: navegar y reservar |
| **11-C Diseño AWS** | README de arquitectura + (opcional) Terraform **no aplicado** | $0 | "Sé el target enterprise; lo despliego cuando haya cuenta" |

\*Free tiers tienen límites (sleep en Render free, cuotas Neon/Upstash). Documentarlo en el README; no vender "0 USD permanente garantizado".

### Stack demo (11-B) — equivalente **funcional**, no AWS

| Rol | En AWS (target 11-C) | Demo portfolio (11-B) |
|-----|----------------------|----------------------|
| Frontend | CloudFront / Amplify / ECS | **Vercel** (Next.js desde GitHub) |
| API | ECS Fargate + ALB | **Render** o **Fly.io** (contenedor `Dockerfile.prod`) |
| Postgres + RLS | RDS + roles `booking_admin`/`booking_app` | **Neon** (Postgres; aplicar `init.sql` + migrate con los mismos roles) |
| Redis | ElastiCache | **Upstash Redis** (TLS) |
| CI | CodePipeline / Actions | **GitHub Actions** (ya verde: lint, unit, e2e, docker-build) |

**Regla de honestidad en el README del repo:** la sección "Live demo" enlaza Vercel/Render; la sección "Production target (AWS)" describe Fargate/RDS/… y apunta a `docs/aws-target.md` (o `infra/`). Nunca "esto corre en AWS" si corre en free tiers.

### DoD de la fase (completo cuando los tres tracks estén listos)

- [ ] **11-A:** ambas imágenes prod construyen; API `GET /health` 200; web sirve `/login`; CI `docker-build` verde.
- [ ] **11-B:** URLs públicas en el README; login + reserva funcionan contra Neon/Upstash; CORS y `NEXT_PUBLIC_API_URL` correctos; mismas migraciones/RLS verificadas (no solo "app enciende").
- [ ] **11-C:** documento de arquitectura AWS (Fargate, dos roles DB, Secrets Manager, ElastiCache) + opcional Terraform sin apply; marcado explícitamente como *not deployed*.

Cuando exista cuenta AWS / créditos: **11-D** (fuera de alcance ahora) = apply real de 11-C sin reescribir la app.

---

## Paso 1 (Track 11-A) — Dockerfiles de producción

**`apps/api/Dockerfile.prod`** — multi-stage:
- Builder: openssl + `npm ci` completo (devDeps para `nest build` / `prisma generate`), `npm run build`.
- Producción: `npm ci --omit=dev --ignore-scripts`; se copia el cliente Prisma ya generado desde el builder.
- Entry: `node dist/src/main.js` (Nest emite bajo `dist/src/` con el `tsconfig` actual).
- Migraciones **fuera** del contenedor (`DATABASE_MIGRATE_URL` + `prisma migrate deploy`), igual que CI.
- `USER node`, `HEALTHCHECK` → `GET /health`.

**`apps/web/Dockerfile.prod`** — `output: 'standalone'` en `next.config.js`:
- `NEXT_PUBLIC_*` se inyectan en **build time** (`--build-arg`), no en runtime del contenedor.
- Stage prod copia `.next/standalone` + static + `public` (`public/` debe existir aunque esté vacío).
- `HOSTNAME=0.0.0.0` para que Render/Fly/Docker expongan el puerto.
- Requiere `apps/web/package-lock.json` para `npm ci`.

**API runtime (demo/cloud):** `PORT` + bind `0.0.0.0`; `CORS_ORIGIN` opcional (origins de Vercel) en `main.ts`.

**CI:** job `docker-build` (`needs: lint-and-unit`) — smoke build, sin ECR.

### Archivos

- `apps/api/Dockerfile.prod`, `apps/web/Dockerfile.prod`
- `apps/web/package-lock.json`, `apps/web/public/`
- `apps/web/next.config.js` — `output: 'standalone'`
- `apps/api/src/main.ts` — `PORT`, `0.0.0.0`, `CORS_ORIGIN`
- `.github/workflows/ci.yml` — job `docker-build`
- `docs/deploy-demo.md` — Track 11-B
- `docs/aws-target.md` — Track 11-C

### Verificación local

```bash
docker build -f apps/api/Dockerfile.prod -t booking-saas-api:local apps/api
docker build -f apps/web/Dockerfile.prod \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 \
  -t booking-saas-web:local apps/web

# API contra Postgres/Redis del compose (red docker):
docker run --rm --network booking-saas_default -p 3011:3001 \
  -e DATABASE_URL='postgresql://booking_app:...@booking-postgres:5432/booking_saas?schema=public' \
  -e REDIS_URL='redis://booking-redis:6379' \
  -e JWT_SECRET=... -e JWT_REFRESH_SECRET=... \
  booking-saas-api:local
curl http://localhost:3011/health
```

### Checklist Paso 1 / Track 11-A

- [x] `docker build` API OK (verificado local).
- [x] `docker build` web OK (con `package-lock.json` + `public/`).
- [x] Imagen API: `GET /health` → 200 (contra Postgres/Redis del compose).
- [x] Imagen web: sirve `/login` → 200.
- [ ] Push → job `docker-build` verde junto a lint/e2e.

### Siguiente

1. Commit + push de 11-A → confirmar `docker-build` en Actions.
2. **Track 11-B:** seguir `docs/deploy-demo.md` (Vercel + Render + Neon + Upstash).
3. **Track 11-C:** `docs/aws-target.md` ya describe el target; Terraform opcional en `infra/` sin apply.

---

## 11-B — Live demo desplegada + datos de demo

**URLs confirmadas:**
- Web: https://booking-saas-web-two.vercel.app/login
- API: https://booking-saas-wrac.onrender.com/health → `200`

Login verificado en los 3 casos (`tenant-a`, `tenant-b`, super admin). `CORS_ORIGIN` y `NEXT_PUBLIC_API_URL` configurados sin slash final, redeploy de Vercel hecho tras el cambio.

### Fix real encontrado: `/book` tenía una fecha de test hardcodeada

`apps/web/app/book/page.tsx` usaba `DEFAULT_DATE = '2026-09-14'` — la fecha de referencia fija de los tests del backend. Funciona para e2e (controlan el reloj), pero en una demo pública real un reclutador la abre en la fecha real del día, no en esa. Reemplazado por `todayAsDateString()`, calculado en el cliente al montar el componente.

### `apps/api/prisma/seed-demo.ts` — script nuevo, separado de `seed.ts`

**Por qué separado y no una extensión de `seed.ts`:** `seed.ts` es el que corre `npm run seed` en docker-compose local **y** en el job `e2e` de CI. Ningún test e2e asume un conteo exacto de sucursales/staff al arrancar (cada uno crea las suyas), así que probablemente habría sido seguro extenderlo — pero "probablemente" no alcanza para algo de lo que depende CI. Un script separado elimina el riesgo por completo: nunca se invoca desde `docker-compose.yml` ni desde `ci.yml`, se corre a mano, una vez, contra Neon.

**Qué crea, por tenant** (mismo patrón de bypass RLS que `seed.ts` — `set_config('app.is_super_admin', 'true', true)` dentro de una transacción, porque este script no tiene contexto de un tenant único):

| | `tenant-a` | `tenant-b` |
|---|---|---|
| Sucursal | Sucursal Centro — `America/Bogota` | Sucursal Reforma — `America/Mexico_City` |
| Servicio | Corte de cabello (30 min + 10 buffer) | Consulta general (45 min + 15 buffer) |
| Staff | `ana@tenant-a.dev` / `ChangeMe123!` | `carlos@tenant-b.dev` / `ChangeMe123!` |
| Horario | Lunes a viernes, 09:00-17:00 local | Lunes a viernes, 09:00-17:00 local |

**Por qué dos timezones reales distintos, no el mismo:** es la forma más visible de que un reclutador confirme con sus propios ojos que la conversión de zona horaria de la Fase 5 funciona de verdad — el mismo horario local en Bogotá y Ciudad de México no cae en el mismo instante UTC.

**Por qué Lunes a Viernes, no un solo día fijo:** una demo pública se abre en la fecha real de cualquier día — sembrar un único día fijo (como hacen los tests) dejaría la demo "vacía" la mayoría de las veces que alguien la visite.

### Comandos (contra Neon, con `booking_app` pooled — mismo patrón de siempre)

```bash
DATABASE_URL="<connection string pooled de booking_app en Neon>" npm run seed:demo
```

### Checklist

- [x] Web y API responden públicamente, login funciona para los 3 casos.
- [x] `/book` usa la fecha real, no una fecha de test.
- [x] `seed-demo.ts` corrido contra Neon — confirmado: `GET /branches` en la API pública devuelve "Sucursal Centro" / `America/Bogota` para `tenant-a` y "Sucursal Reforma" / `America/Mexico_City` para `tenant-b`.
- [x] Flujo `/book` completo (sucursal → servicio → staff → slot real → `201`) probado en la demo pública — confirmado, `201` real en la UI de Vercel contra la API de Render.
- [x] README con la sección "Live demo" arriba del todo.

### Siguiente

**11-B cerrado formalmente.** Los 3 tracks honestos de la Fase 11 quedan: 11-A (artefactos Docker/CI) ✅, 11-B (demo live free) ✅, 11-C (diseño AWS + Terraform sin aplicar) — pendiente, es lo que sigue.

---

# Fase 12: UX del frontend — Bitácora

**Alcance:** casi solo `apps/web`. Un cambio de backend, acotado (ver abajo). Sin Terraform, sin tocar Prisma/RLS/migraciones. CI: `lint-and-unit` y `e2e` no buildean `apps/web`; `docker-build` sí corre `next build` de web, así que un `useSearchParams` sin `<Suspense>` rompería ese job.

> El “Fase 12” mencionado en la bitácora de multi-tenancy (asistente de IA / no mezclar LLM dentro del interceptor RLS) es **otro tema, numeración vieja**. Esta Fase 12 es **UX del front**. El aviso del interceptor sigue válido para cuando exista IA.

## El único cambio de backend, y por qué entra dentro de lo permitido

`BookingsService.findAll()` (`GET /bookings`, ya existía) ahora incluye `branch.name`, `service.name`, `staff.user.email` vía `include` de Prisma. **Aditivo:** los campos planos siguen. Sin esto, “Reservas” mostraría UUIDs. Los e2e de bookings no hacen `toEqual` del objeto entero; el test de CLIENT vs CLIENT sigue filtrando por `clientId`.

**Matiz de producto:** un `TENANT_ADMIN` ve las reservas **del tenant** (no un filtro “solo las mías”). El título del dashboard es “Reservas”, no “Mis reservas”, para no mentir. Un `CLIENT` sí está limitado a las suyas en el mismo endpoint.

## P0 — flujo usable

- **`components/Header.tsx`** — Dashboard (botón borde), Nueva reserva (botón primario negro), Cerrar sesión. En `dashboard` y `/book`, no en `login`.
- **Botón "← Atrás" en `/book`** — `PREVIOUS_STEP`. Las **listas** (sucursales/servicios/staff) se conservan; las **selecciones del paso que abandonás** se limpian (si no, el chip “Corte de cabello” seguía visible al volver a “elegí un servicio”).
- **Chips** — solo muestran pasos **ya confirmados** (anteriores al paso actual).
- **Sucursal del dashboard → `/book?branchId=<id>`** — `Link` + preselect. `useSearchParams` va en `BookPageContent` dentro de `<Suspense>` (`BookPage` wrapper) para no romper `next build` / Vercel / `docker-build`.
- El preselect usa un `ref` para no disparar `chooseBranch` dos veces (Strict Mode).

## P1 — cierre del loop

- **“Reservas”** en el dashboard — `GET /bookings`, loading/vacío/error, nombres vía `include`. Orden en UI: más recientes primero (`startTime` desc, solo front).
- Tras confirmar: “Hacer otra reserva” + “Volver al dashboard”.

## P2 — login demo + estilo mínimo

- Login: `<select>` Clínica / Salón / super admin / “Otro” (slug libre).
- Tailwind existente, sin design system nuevo.

## P2b (post-checklist original) — listas largas

Verificado en local con `npm run seed:visual` (30+ sucursales). Sin esto el dashboard era un scroll infinito.

- `components/use-paged-list.ts` — 8 ítems + “Ver más” + buscar si hay más de 8.
- Grid 2 columnas + CTA “Reservar →” en sucursales.
- El mismo tope de 8 + buscar en el paso 1 de `/book`.

**`prisma/seed-visual-qa.ts` + `npm run seed:visual`:** solo QA **local**. Nunca CI, nunca Neon (ensucia la demo pública).

## Archivos nuevos

- `apps/web/components/Header.tsx`
- `apps/web/components/use-paged-list.ts`
- `apps/api/prisma/seed-demo.ts` (datos de sucursal/servicio/staff para demo; no está en CI)
- `apps/api/prisma/seed-visual-qa.ts` (solo local)

## Archivos modificados

- `apps/web/app/book/page.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/login/page.tsx`
- `apps/web/lib/types.ts`
- `apps/api/src/bookings/bookings.service.ts` — `include` en `findAll()`
- `apps/api/package.json` — `seed:demo`, `seed:visual`

## Comandos de verificación local

```bash
# Web — el `next build` dentro del contenedor de *dev* comparte `.next` con
# `next dev` y puede fallar con un error de Html/_document irrelevante.
# El check real es el mismo que CI:
docker build -f apps/web/Dockerfile.prod \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 \
  -t booking-saas-web:local apps/web

# API e2e (incluye GET /bookings + include)
docker exec booking-api npm run test:e2e
```

Demo limpia local (después de `docker-compose down -v`): migrate como `booking_admin`, luego `seed` y `seed:demo` como `booking_app`. Tras un reset de volumen, **cerrar sesión** en el browser (el JWT viejo apunta a UUIDs que ya no existen → 0 sucursales).

## Checklist

- [x] `/book` tiene "← Atrás" salvo el primer paso; al volver se limpian chips/selección de ese paso (las listas no se re-fetch).
- [x] Click en sucursal del dashboard abre `/book?branchId=` y salta al Paso 2.
- [x] Header en dashboard y `/book`; ausente en `/login`.
- [x] Dashboard muestra reservas con nombres, no UUIDs; loading/empty/error.
- [x] Tras confirmar, "Volver al dashboard".
- [x] Login con select `tenant-a`/`tenant-b`; "Otro" permite slug libre.
- [x] Sucursales/reservas no se vuelcan todas: página de 8 + Ver más + buscar (probado con seed visual local).
- [ ] `npm run test:e2e` (backend) verde tras el `include` — correr antes del push (el test de CLIENT solo afirma `clientId`; el include no debería romperlo).
- [x] Imagen prod web (`Dockerfile.prod`, mismo job `docker-build`) compila `/book` `/dashboard` `/login` sin warning de Suspense.
- [ ] Push a GitHub → `lint-and-unit`, `e2e`, `docker-build` verdes (Fase 12 **aún no está en `origin/main`**).
- [ ] Vercel muestra este front (hace falta push + redeploy).

Cuando el push esté verde y Vercel actualizado, **11-C** (Terraform `not applied`) puede seguir — no antes, y no es más urgente que ver la demo pública con esta UX.
