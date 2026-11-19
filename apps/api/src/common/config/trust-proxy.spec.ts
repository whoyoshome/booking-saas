import type { NestExpressApplication } from '@nestjs/platform-express';
import { applyTrustProxy, parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['  ', 0],
    ['0', 0],
    ['1', 1],
    [' 2 ', 2],
    ['10', 10],
  ])('%p -> %p hops', (value, hops) => {
    expect(parseTrustProxy(value)).toBe(hops);
  });

  it.each(['true', 'false', 'yes', '-1', '1.5', '11', 'loopback', '10.0.0.0/8'])(
    'rejects %p instead of guessing',
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY must be a whole number/);
    },
  );
});

describe('applyTrustProxy', () => {
  function fakeApp() {
    const set = jest.fn();
    return { app: { set } as unknown as NestExpressApplication, set };
  }

  it('sets Express "trust proxy" to the hop count', () => {
    const { app, set } = fakeApp();
    expect(applyTrustProxy(app, '1')).toBe(1);
    expect(set).toHaveBeenCalledWith('trust proxy', 1);
  });

  it('leaves Express untouched when TRUST_PROXY is unset or 0', () => {
    for (const value of [undefined, '0']) {
      const { app, set } = fakeApp();
      expect(applyTrustProxy(app, value)).toBe(0);
      expect(set).not.toHaveBeenCalled();
    }
  });
});
