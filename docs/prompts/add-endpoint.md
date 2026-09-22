# Prompt: agregar un endpoint nuevo

Usar cuando se necesita una ruta nueva de NestJS en `apps/api`.

---

Agregar [MÉTODO] `/[path]` en `apps/api/src/[módulo]/`.

Requisitos:
- El controller usa `@TenantScoped()` a nivel de clase (ver cualquier controller existente, ej. `branches.controller.ts`, para el patrón). Agregar `@Roles(...)` solo si esta ruta debe restringirse más allá de "cualquier rol autenticado con contexto de tenant".
- El service consulta vía `this.prisma.client.*`, nunca `this.prisma.*` directo.
- DTO con decoradores de `class-validator` para el body/query — seguir el estilo de DTO ya usado en ese módulo (o el más parecido).
- Si esto toca un modelo Prisma nuevo o una tabla nueva: **parar**. No crear migraciones sin confirmar el cambio de schema primero — los modelos de Prisma y las policies de RLS se revisan aparte, no se infieren de un pedido de endpoint.
- Agregar al menos un test e2e en `apps/api/test/` cubriendo: el camino feliz, y un 404 cross-tenant (pedir el mismo recurso con el token de otro tenant, confirmar 404 no 403 — es la convención establecida del proyecto, ver la bitácora de las Fases 3/4 del README para el porqué).
- Correr `npm run test:e2e` y confirmar que el suite completo (no solo el test nuevo) sigue en verde antes de reportar terminado.

No agregar este endpoint al frontend salvo que se pida explícitamente — un PR solo de backend es un entregable válido acá.
