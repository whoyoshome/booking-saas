# AI assist

`POST /ai/assist` is a read-only assistant in the admin/staff dashboard. It answers questions about the requesting tenant's `PENDING` bookings. This document is its contract: what it guarantees, what it does not, and why.

## Access

- `@TenantScoped()` plus `@Roles(TENANT_ADMIN, STAFF)`, the same mechanism as the rest of the API. A `CLIENT` receives `403` before the request reaches the service.
- Rate limit: 5 requests per 60 seconds, stricter than the global 100 per 60 seconds, because every request has a direct LLM cost.

## Grounding

The only data the model sees is the tenant's `PENDING` bookings, loaded with `this.prisma.client.booking.findMany(...)`, never `this.prisma`.

- RLS scopes the query to the caller's tenant, like every other tenant-scoped query. There is no separate access path for AI.
- No writes. The service never calls `create`, `update` or `delete`. Confirming or cancelling still goes through `PATCH /bookings/:id/confirm|cancel` with its own RBAC and business rules; an answer is informational text, never a side effect.
- At most 50 bookings per request (`MAX_GROUNDING_BOOKINGS`), which bounds token cost.

## System prompt

The exact prompt in `ai-assist.service.ts`:

> You are a read-only assistant embedded in a booking admin dashboard. Answer ONLY using the JSON data provided in the next message — it is the complete and only source of truth available to you. If the answer is not fully contained in that JSON, say explicitly that you do not have that information — never guess, estimate, or invent a booking, time, or name that is not present in the data. You have no ability to create, confirm, or cancel bookings, and no access to any data beyond what is given below — never imply that you performed, or can perform, any action, and never reference information outside the provided JSON. Answer in the same language as the question.

It states three guarantees explicitly:

1. The attached JSON is the only source of truth, not the model's general knowledge.
2. "I don't have that information" is a valid, expected answer.
3. The model never implies it performed an action. It has no write tools, but the prompt rules out ambiguous replies such as "done, I confirmed the booking".

`temperature: 0`: this is an administrative data tool, not a conversational one.

## Missing configuration

Without `OPENAI_API_KEY`, the endpoint returns `503 Service Unavailable` with `"AI assist is not configured on this environment (missing OPENAI_API_KEY)."`. This is the default in CI and in the hosted demo. The dashboard still shows the button to admins and staff, so the feature reports itself as unconfigured instead of looking broken. Upstream failures and empty model responses also return `503`.

## Test coverage

`apps/api/test/ai-assist.e2e-spec.ts` covers what can be verified without a real key: RBAC (`403` for `CLIENT`), input validation (`400`) and the `503` contract.

Not covered:

- A successful OpenAI call, and whether the prompt prevents hallucinations in practice. Both would need a real key and incur cost on every CI run.
- RLS isolation of the grounding query through this endpoint. It relies on the same pattern that `tenant-isolation.e2e-spec.ts` already tests.

## Non-goals

- Not an agent: it returns text and takes no actions.
- No RAG or embeddings (out of scope; see `AGENTS.md`).
- No memory between requests; every question is independent.
- Grounding is limited to `PENDING` bookings. Adding availability or other sources is an explicit scope change.
