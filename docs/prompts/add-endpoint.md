# Prompt: add an endpoint

Use when a new NestJS route is needed in `apps/api`.

---

Add [METHOD] `/[path]` in `apps/api/src/[module]/`.

Requirements:
- The controller uses `@TenantScoped()` at class level (see any existing controller, e.g. `branches.controller.ts`). Add `@Roles(...)` only if the route must be narrower than "any authenticated role with a tenant context".
- The service queries through `this.prisma.client.*`, never `this.prisma.*`.
- Use a DTO with `class-validator` decorators for the body or query, following the style already used in that module.
- If this needs a new Prisma model or table: **stop**. Do not create migrations without confirming the schema change first; Prisma models and RLS policies are reviewed separately, not inferred from an endpoint request.
- Add at least one e2e test in `apps/api/test/` covering the happy path and a cross-tenant 404 (request the same resource with another tenant's token and expect 404, not 403; see `docs/design-decisions.md` for why).
- Run `npm run test:e2e` and confirm the whole suite, not just the new test, passes before reporting done.

Do not wire the endpoint into the frontend unless asked; a backend-only PR is a valid deliverable.
