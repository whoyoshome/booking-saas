import type { NestExpressApplication } from '@nestjs/platform-express';

const MAX_HOPS = 10;

/**
 * TRUST_PROXY = how many reverse proxies sit in front of the API.
 *
 * Express then takes the client address from X-Forwarded-For that many hops
 * from the right, so `req.ip` (what ThrottlerGuard tracks) is the real
 * client instead of the proxy. Without it, every user behind the platform's
 * load balancer shares one IP, and the 5 logins/min limit becomes global.
 *
 * Unset or 0: proxies are not trusted (local dev, direct connections).
 * Only a whole number is accepted: `true` would trust every entry in
 * X-Forwarded-For, which a client can set itself to spoof its IP and dodge
 * the rate limit.
 */
export function parseTrustProxy(value: string | undefined): number {
  const raw = (value ?? '').trim();
  if (raw === '') return 0;
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_HOPS) {
    throw new Error(
      `TRUST_PROXY must be a whole number of proxy hops between 0 and ${MAX_HOPS}, got "${value}". ` +
        '"true" is not accepted: trusting every hop lets clients spoof their IP via X-Forwarded-For.',
    );
  }
  return Number(raw);
}

/** Applies TRUST_PROXY (see parseTrustProxy) to the Express adapter. Returns the hop count. */
export function applyTrustProxy(
  app: NestExpressApplication,
  value: string | undefined = process.env.TRUST_PROXY,
): number {
  const hops = parseTrustProxy(value);
  if (hops > 0) {
    app.set('trust proxy', hops);
  }
  return hops;
}
