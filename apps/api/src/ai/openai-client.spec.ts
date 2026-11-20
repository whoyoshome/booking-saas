import { createOpenAiClient, parseOpenAiTimeout } from './openai-client';

describe('parseOpenAiTimeout', () => {
  it.each([
    [undefined, 20_000],
    ['', 20_000],
    ['15000', 15_000],
    [' 500 ', 500],
  ])('%p -> %p ms', (value, ms) => {
    expect(parseOpenAiTimeout(value)).toBe(ms);
  });

  it.each(['0', '99', '120001', '1.5', '20s', '-1'])('rejects %p at startup', (value) => {
    expect(() => parseOpenAiTimeout(value)).toThrow(/OPENAI_TIMEOUT_MS must be/);
  });
});

describe('createOpenAiClient', () => {
  it('returns null without OPENAI_API_KEY, so the endpoint answers 503', () => {
    expect(createOpenAiClient({})).toBeNull();
  });

  it('configures one client with the timeout, no retries and the optional base URL', () => {
    const client = createOpenAiClient({
      OPENAI_API_KEY: 'test-key',
      OPENAI_TIMEOUT_MS: '1500',
      OPENAI_BASE_URL: 'http://127.0.0.1:9999/v1',
    });

    expect(client).not.toBeNull();
    expect(client!.timeout).toBe(1_500);
    expect(client!.maxRetries).toBe(0);
    expect(client!.baseURL).toBe('http://127.0.0.1:9999/v1');
  });

  it('validates OPENAI_TIMEOUT_MS even when the key is missing', () => {
    expect(() => createOpenAiClient({ OPENAI_TIMEOUT_MS: 'soon' })).toThrow(/OPENAI_TIMEOUT_MS/);
  });
});
