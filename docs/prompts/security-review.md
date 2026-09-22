# Prompt: revisión de seguridad de un cambio o módulo

Usar para revisar un diff o un módulo existente contra los patrones de seguridad de los que depende este proyecto.

---

Revisar [archivo(s)/PR/módulo] contra este checklist. Para cada ítem, responder explícitamente sí/no/N-A con una razón de una línea — no alcanza con "se ve bien".

- [ ] Toda query que toca una tabla con scope de tenant usa `this.prisma.client.*`, no `this.prisma.*`.
- [ ] Todo controller/ruta que maneja datos de tenant tiene `@TenantScoped()`.
- [ ] Toda ruta restringida más allá de "cualquier rol autenticado" tiene un `@Roles(...)` explícito, y la restricción coincide con lo que la lógica de negocio realmente requiere (ni más amplia ni más angosta).
- [ ] Ninguna query nueva acepta un `tenantId` (o equivalente) directo del body/query de la request y confía en él — la identidad de tenant siempre viene del JWT (`user.tenantId`), nunca de un input del cliente.
- [ ] Ninguna fuga nueva de "existencia" cross-tenant — un pedido por ID de un recurso de otro tenant devuelve 404, nunca 403 (403 confirma que el recurso existe).
- [ ] Ningún secreto (clave de firma JWT, password de DB, API key) se loggea, se devuelve en una respuesta de API, o se commitea en un archivo.
- [ ] Si se agregó una llamada externa nueva (ej. una API de LLM), confirmar que tiene rate limit / timeout, y que no puede usarse para exfiltrar más datos que el mínimo necesario para la tarea.

No aprobar el propio cambio de uno — este checklist es para reportar hallazgos, no para auto-certificar "todo bien" sin evidencia (citar el archivo/línea específica de cada ítem marcado).
