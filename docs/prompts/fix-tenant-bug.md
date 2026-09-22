# Prompt: corregir un posible bug de aislamiento de tenant

Usar cuando algo parece filtrar datos entre tenants, o una query parece bypasear RLS.

---

Investigar [describir el síntoma — ej. "el tenant B puede ver el X del tenant A"].

Antes de cambiar nada:
1. Encontrar la query exacta responsable. Revisar si usa `this.prisma.client.*` (con scope RLS) o `this.prisma.*` (bypaseado). El bug muy probablemente está justo ahí.
2. Confirmar qué controller/ruta dispara esto, y si tiene `@TenantScoped()`.
3. Escribir un test e2e que falle **primero**, reproduciendo la fuga exactamente (crear datos como tenant A, pedir/consultar como tenant B, confirmar la fuga — ver `tenant-isolation.e2e-spec.ts` para el patrón ya establecido de este tipo de test).

Después corregirlo — el cambio mínimo, no un refactor. Volver a correr ese test nuevo para confirmar que ahora pasa, y correr el suite completo `npm run test:e2e` para confirmar que nada más se rompió.

Reportar: cuál fue la causa raíz, el diff, y el test nuevo/actualizado que prueba que está corregido. Si la corrección requiere tocar policies de RLS o migraciones, parar y describir el SQL propuesto antes de aplicarlo — no correr SQL crudo contra una base de datos real sin avisar.
