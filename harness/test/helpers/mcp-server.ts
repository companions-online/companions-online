import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface TestMcpServerHandle {
  url: string;
  close: () => Promise<void>;
}

/**
 * Spin up an in-process MCP server on an ephemeral port with 3 trivial tools.
 * Each incoming request gets its own transport+server (stateless), which is
 * fine for the lifetime of a single test.
 */
export async function startTestMcpServer(): Promise<TestMcpServerHandle> {
  const server: Server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) {
      res.statusCode = 404; res.end(); return;
    }
    // Stateless: new transport per request. McpServer is re-built per request
    // with the same tools.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcp = new McpServer({ name: 'test-mcp', version: '0.1.0' });
    registerTestTools(mcp);
    await mcp.connect(transport);

    // Collect body so we can pass as parsedBody (avoids stream/body-parser
    // fiddling for POST requests).
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown = undefined;
      if (text) { try { parsed = JSON.parse(text); } catch { /* noop */ } }
      await transport.handleRequest(req, res, parsed);
    } else {
      await transport.handleRequest(req, res);
    }
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  return {
    url,
    async close() {
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

function registerTestTools(mcp: McpServer): void {
  mcp.registerTool('echo', {
    description: 'Echo a message back.',
    inputSchema: { message: z.string() },
  }, async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  }));

  mcp.registerTool('add', {
    description: 'Add two numbers.',
    inputSchema: { a: z.number(), b: z.number() },
  }, async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }));

  mcp.registerTool('now', {
    description: 'Returns a fixed timestamp for deterministic tests.',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: '2026-04-21T00:00:00Z' }],
  }));
}
