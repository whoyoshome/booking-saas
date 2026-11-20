import OpenAI from 'openai';

/** Injection token for the process-wide OpenAI client (or null when unconfigured). */
export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;

/** OPENAI_TIMEOUT_MS: whole milliseconds; unset uses the 20 s default. Anything else fails at startup. */
export function parseOpenAiTimeout(value: string | undefined): number {
  const raw = (value ?? '').trim();
  if (raw === '') return DEFAULT_TIMEOUT_MS;
  const ms = Number(raw);
  if (!/^\d+$/.test(raw) || ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS) {
    throw new Error(
      `OPENAI_TIMEOUT_MS must be whole milliseconds between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}, got "${value}".`,
    );
  }
  return ms;
}

/**
 * ONE client for the whole process, so connections are reused, instead of a
 * new client per request. Null when OPENAI_API_KEY is unset: the endpoint
 * then answers 503 (docs/ai-assist.md).
 *
 * - timeout: OPENAI_TIMEOUT_MS (default 20 s). The SDK's own default is
 *   10 minutes.
 * - maxRetries: 0. The SDK retries twice by default, which triples the
 *   worst case for a request an admin is waiting on; a failure becomes a
 *   503 and the admin can simply ask again.
 * - baseURL: OPENAI_BASE_URL when set (the e2e tests point it at a fake
 *   server); otherwise the SDK's default.
 */
export function createOpenAiClient(env: NodeJS.ProcessEnv = process.env): OpenAI | null {
  const timeout = parseOpenAiTimeout(env.OPENAI_TIMEOUT_MS);
  if (!env.OPENAI_API_KEY) return null;
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
    timeout,
    maxRetries: 0,
  });
}
