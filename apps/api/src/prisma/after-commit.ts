/**
 * Returned by a @TenantScoped() handler when part of its work must NOT run
 * inside the request's RLS transaction — typically a slow external call
 * such as an LLM request, which would otherwise hold a Postgres connection
 * open and race the transaction's 10 s timeout.
 *
 * TenantContextInterceptor commits the transaction first, then runs `step`
 * and responds with its result. Inside `step` there is no tenant context:
 * PrismaService.client throws, so the step can only use data it captured
 * while the transaction was open. Read everything you need before returning
 * this, and never write after commit.
 */
export class AfterCommit<T> {
  constructor(readonly step: () => Promise<T>) {}
}
