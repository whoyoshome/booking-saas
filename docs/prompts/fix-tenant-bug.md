# Prompt: fix a suspected tenant isolation bug

Use when data appears to leak between tenants, or a query appears to bypass RLS.

---

Investigate [describe the symptom, e.g. "tenant B can see tenant A's X"].

Before changing anything:
1. Find the exact query responsible. Check whether it uses `this.prisma.client.*` (RLS-scoped) or `this.prisma.*` (unscoped); the bug is most likely there.
2. Confirm which controller and route trigger it, and whether it has `@TenantScoped()`.
3. Write an e2e test that fails **first** by reproducing the leak: create data as tenant A, query as tenant B, observe the leak. Follow the pattern in `tenant-isolation.e2e-spec.ts`.

Then apply the minimal fix, not a refactor. Re-run the new test to confirm it passes, and run the full `npm run test:e2e` suite to confirm nothing else broke.

Report the root cause, the diff, and the new or updated test that proves the fix. If the fix requires changing RLS policies or migrations, stop and describe the proposed SQL before applying it; never run raw SQL against a real database without asking.
