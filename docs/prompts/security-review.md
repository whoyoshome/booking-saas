# Prompt: security review of a change or module

Use to review a diff or an existing module against the security patterns this project depends on.

---

Review [file(s)/PR/module] against this checklist. For each item, answer yes / no / N/A with a one-line reason; "looks fine" is not an answer.

- [ ] Every query on a tenant-scoped table uses `this.prisma.client.*`, not `this.prisma.*`.
- [ ] Every controller or route handling tenant data has `@TenantScoped()`.
- [ ] Every route restricted beyond "any authenticated role" has an explicit `@Roles(...)`, and the restriction matches what the business logic actually requires (neither broader nor narrower).
- [ ] No query trusts a `tenantId` (or equivalent) from the request body or query string; tenant identity always comes from the JWT (`user.tenantId`).
- [ ] No new cross-tenant existence leak: requesting another tenant's resource by ID returns 404, never 403 (403 confirms the resource exists).
- [ ] No secret (JWT signing key, database password, API key) is logged, returned in a response or committed to a file.
- [ ] Any new external call (e.g. an LLM API) has a rate limit and a timeout, and cannot be used to exfiltrate more data than the task needs.

Do not approve your own change. This checklist reports findings; cite the specific file and line for every item you mark.
