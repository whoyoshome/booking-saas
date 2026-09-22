# AI assist — contrato anti-alucinación

`POST /ai/assist` es un asistente de solo lectura embebido en el dashboard de admin/staff. Responde preguntas sobre las reservas `PENDING` del tenant que hace la consulta. Este documento es el contrato: qué garantiza, qué no, y por qué está diseñado así.

## Quién puede usarlo

`@TenantScoped()` + `@Roles(TENANT_ADMIN, STAFF)` — mismo mecanismo que protege el resto de la API (ver `AGENTS.md`). Un `CLIENT` recibe `403` antes de que el request llegue al service. Rate limit estricto: `5` requests / `60s` — más estricto que el default global (`100/60s`) e incluso que el de login (`5/60s`, pero acá el costo por request es real dinero de la API del LLM, no solo carga de servidor).

## Grounding: de dónde sale la respuesta

La única fuente de datos que ve el modelo son las reservas `PENDING` del tenant que hace la request, consultadas vía `this.prisma.client.booking.findMany(...)` — **nunca** `this.prisma` directo. Esto significa:

- RLS acota la query al tenant del caller, exactamente igual que cualquier otra query tenant-scoped de este proyecto — no hay una ruta de acceso especial para IA.
- Sin escritura, nunca. El service no tiene ningún método que llame `.create`/`.update`/`.delete`. Confirmar o cancelar una reserva sigue pasando por `PATCH /bookings/:id/confirm|cancel`, con su propio RBAC y sus propias reglas de negocio — una respuesta del asistente es texto informativo, nunca un efecto de lado.
- Tope de 50 reservas por consulta (`MAX_GROUNDING_BOOKINGS`) — acota el costo de tokens y es, de paso, un techo razonable de lo que un admin puede revisar de una sentada.

## El prompt anti-alucinación

El system prompt exacto (`ai-assist.service.ts`):

> You are a read-only assistant embedded in a booking admin dashboard. Answer ONLY using the JSON data provided in the next message — it is the complete and only source of truth available to you. If the answer is not fully contained in that JSON, say explicitly that you do not have that information — never guess, estimate, or invent a booking, time, or name that is not present in the data. You have no ability to create, confirm, or cancel bookings, and no access to any data beyond what is given below — never imply that you performed, or can perform, any action, and never reference information outside the provided JSON. Answer in the same language as the question.

Tres garantías explícitas en ese texto, no implícitas:
1. **La única fuente de verdad es el JSON adjunto** — no el conocimiento general del modelo.
2. **Decir "no tengo esa información" es una respuesta válida y esperada**, no una falla.
3. **Nunca implicar que ejecutó una acción** — el modelo no tiene ninguna tool de escritura, pero el prompt lo deja explícito igual, para que no redacte una respuesta ambigua tipo "listo, confirmé la reserva" cuando no hizo nada.

`temperature: 0` — determinismo, no creatividad. Esto es una herramienta de datos administrativos, no un chatbot conversacional.

## Sin `OPENAI_API_KEY` configurada

`503 Service Unavailable` con el mensaje `"AI assist is not configured on this environment (missing OPENAI_API_KEY)."` — explícito, no un error genérico. **Este es el comportamiento por defecto tanto en CI como en la demo pública actual** (no hay ningún secret de OpenAI configurado en ninguno de los dos). El botón "Preguntar" del dashboard sigue visible para `TENANT_ADMIN`/`STAFF` — mostrar el mensaje de "no configurado" es mejor que ocultar la feature entera y que alguien se pregunte si está rota.

## Límite de testing conocido, dicho explícito

`apps/api/test/ai-assist.e2e-spec.ts` prueba los 3 guardarraíles verificables sin una API key real: RBAC (`403` para `CLIENT`), validación de input (`400`), y el contrato de `503` sin configurar — que es exactamente lo que CI ejercita, porque CI no tiene `OPENAI_API_KEY` como secret a propósito. **Lo que el e2e no prueba:** el camino feliz real (una llamada exitosa a OpenAI) ni que el prompt efectivamente evita alucinaciones en la práctica — eso requeriría una key real y gasto de dinero en cada corrida de CI, lo cual no se justifica para este alcance. El aislamiento por RLS de la query de grounding se confía por consistencia con el patrón ya probado extensivamente en `tenant-isolation.e2e-spec.ts`, no se re-prueba a través de este endpoint específico.

## Qué NO es esta feature

- No es un agente que actúa — solo responde texto.
- No es RAG ni usa embeddings — eso es Fase 3, explícitamente no planificada todavía (ver `AGENTS.md`).
- No tiene memoria entre requests — cada pregunta es un request nuevo, sin historial de conversación.
- No consulta disponibilidad (`GET /availability`) todavía — el grounding actual es solo reservas `PENDING`. Ampliarlo es un cambio de scope explícito, no algo para agregar en silencio.
