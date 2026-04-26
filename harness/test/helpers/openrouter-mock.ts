import { createServer, type Server } from 'node:http';
import type { ChatResponse } from '../../helpers/openrouter.js';

export interface CapturedRequest {
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

export interface MockOpenRouterHandle {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/**
 * Replays responses in order by call index. If the harness makes more calls
 * than fixtures provided, responds 500.
 */
export async function startMockOpenRouter(responses: ChatResponse[]): Promise<MockOpenRouterHandle> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.statusCode = 404; res.end(); return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* noop */ }
    requests.push({ body, headers: req.headers });

    const idx = requests.length - 1;
    const resp = responses[idx];
    if (!resp) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'no fixture for index ' + idx }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(resp));
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  return {
    baseUrl,
    requests,
    async close() { await new Promise<void>(r => server.close(() => r())); },
  };
}
