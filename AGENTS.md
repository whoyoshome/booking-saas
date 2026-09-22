# AGENTS.md

Instrucciones para cualquier agente de IA (Claude Code, Cursor, Copilot Workspace, etc.) que trabaje en este repositorio. Leer esto antes de tocar código.

## Reglas duras — nunca violarlas

1. **Nunca bypasear Row Level Security.** Toda query que toque una tabla con scope de tenant (`users`, `branches`, `services`, `staff`, `staff_services`, `staff_schedules`, `branch_schedules`, `bookings`, y sus tablas de excepciones) **debe** pasar por `this.prisma.client.*`, nunca `this.prisma.*` directo. `this.prisma.client` resuelve al cliente transaccional con contexto RLS que abre `TenantContextInterceptor`; el `this.prisma` crudo es la conexión sin scope y solo existe legítimamente para `AuthService` (necesita resolver identidad antes de que exista un tenant al cual acotar) y los dos scripts de sistema (`prisma/seed.ts`, `bookings-cleanup.service.ts`) que ya usan el bypass `set_config('app.is_super_admin', 'true', true)`. No agregar un tercer caller de ese bypass sin preguntar primero.
2. **Nunca inventar un endpoint que no exista ya.** Si una tarea parece necesitar una ruta nueva, proponerla y parar — no agregarla en silencio. Revisar `apps/api/src/*/*.controller.ts` para confirmar qué existe realmente antes de asumir.
3. **Nunca commitear `.env` ni pegar secretos reales** en un diff, mensaje de commit, o archivo generado. `.env.example` documenta la forma; los valores reales viven en el entorno de cada persona.
4. **Correr el suite e2e antes de dar por terminado un cambio de backend.** `cd apps/api && npm run test:e2e` — 59 tests, todos deben seguir en verde. Si se tocó `apps/api/src/**`, se tocó algo que este suite existe para proteger.
5. **Diffs mínimos.** No reformatear, reordenar imports, ni reescribir código no relacionado "ya que estamos". Quien revisa necesita ver exactamente qué cambió y por qué.
6. **El stack está fijo. No introducir:** GraphQL, MongoDB/cualquier datastore no relacional, Terraform/OpenTofu (la infra de AWS está diseñada-pero-no-aplicada en `docs/aws-target.md` — leer ese archivo antes de tocar cualquier cosa de AWS), ni ningún ORM que no sea Prisma. Si una tarea parece requerir alguno de estos, parar y preguntar en vez de agregarlo.

## Invariantes de arquitectura que un agente debe respetar

- **Dos roles de Postgres, siempre.** `DATABASE_URL` = `booking_app` (no superusuario, sujeto a RLS) — la única conexión que usa la app en runtime. `DATABASE_MIGRATE_URL` = `booking_admin` (dueño) — solo migraciones y scripts administrativos. Nunca apuntar código de runtime a la URL de migración.
- **`@TenantScoped()`** en todo controller/ruta que toque datos de tenant — combina `JwtAuthGuard` + `TenantGuard` + `RolesGuard` + `TenantContextInterceptor`. Un controller nuevo que se lo salta es un bug, no un atajo válido.
- **La garantía anti-double-booking vive en PostgreSQL** (`EXCLUDE USING gist` sobre `bookings`, migración `add_bookings_constraints`), no en código de aplicación. Nunca agregar un `if (available) createBooking()` como fuente de verdad — ver la bitácora de la Fase 6 del README para el porqué.
- **`GET /availability` y `POST /bookings` usan modos de consistencia de cache distintos a propósito** (`ignoreBookings: true` en el chequeo de escritura, `false` en la lectura). No "simplificar" esto a una sola llamada — se separó deliberadamente para evitar flakiness por TOCTOU bajo concurrencia real (ver bitácora Fase 6/8).
- **Zonas horarias:** la hora local de pared se guarda tal cual (`@db.Time`/`@db.Date` de Prisma); la conversión a un instante UTC real ocurre **solo** dentro de `AvailabilityService`, vía Luxon, contra `branch.timezone`. Nunca hacer aritmética de fechas ad-hoc con horarios de schedule en otro lugar.

## Antes de empezar cualquier tarea

1. Leer la bitácora de la Fase correspondiente en `docs/engineering-log.md` — la propia historia de construcción de este proyecto es el mejor contexto para "por qué está armado así". El `README.md` es solo la portada (demo, stack, arranque).
2. Revisar `docs/prompts/` por una plantilla que coincida con el tipo de tarea.
3. Si la tarea no encaja claramente en ninguna regla dura de arriba pero hay duda de si cuenta como "inventar scope", parar y preguntar en vez de adivinar.

## `POST /ai/assist` (Fase 2, ya implementado)

Asistente de solo lectura, grounding estricto vía `this.prisma.client` sobre las reservas `PENDING` del tenant, sin ninguna capacidad de escritura. Contrato completo en `docs/ai-assist.md`. Si se extiende esta feature (más fuentes de datos, otro endpoint que llame a un LLM), seguir el mismo patrón: grounding read-only explícito, prompt que dice "si no está en los datos, decilo", y `503` claro si falta configuración — no asumir que "funciona distinto acá porque es IA".

## Fase 3 (futuro, no planificada todavía) — embeddings/RAG

No es parte del roadmap actual. Si una tarea futura pide embeddings, un vector store, o RAG sobre los datos de reservas, tratarlo como scope nuevo que requiere aprobación explícita — no agregar `pgvector`, un pipeline de embeddings, ni una dependencia de vector DB de forma preventiva.
