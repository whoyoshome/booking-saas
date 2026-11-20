import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeOpenAiBehavior {
  /** How long to wait before answering. */
  delayMs: number;
  /** HTTP status to answer with; anything but 200 is an upstream error. */
  status: number;
  /** The assistant message content for a 200. */
  content: string;
}

/** A recorded chat-completions request body. */
export interface FakeOpenAiRequest {
  model: string;
  messages: { role: string; content: string }[];
}

/**
 * A local stand-in for the OpenAI API, so the real SDK (timeouts, retries,
 * error types) runs against something whose speed and failures the test
 * controls. Point OPENAI_BASE_URL at `baseURL`.
 */
export async function startFakeOpenAi() {
  const behavior: FakeOpenAiBehavior = { delayMs: 0, status: 200, content: 'Fake answer.' };
  const requests: FakeOpenAiRequest[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      requests.push(JSON.parse(body) as FakeOpenAiRequest);
      const { delayMs, status, content } = { ...behavior };
      setTimeout(() => {
        if (res.destroyed) return; // the client gave up (timeout)
        if (status !== 200) {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'fake upstream failure', type: 'server_error' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-fake',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'fake-model',
            choices: [
              { index: 0, finish_reason: 'stop', message: { role: 'assistant', content } },
            ],
          }),
        );
      }, delayMs);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    set(next: Partial<FakeOpenAiBehavior>) {
      Object.assign(behavior, next);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
