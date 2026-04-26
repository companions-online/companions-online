import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Logger } from './logger.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpCallResult {
  content: unknown[];
  isError?: boolean;
}

/**
 * Reconnecting MCP client. `listTools` is refreshed on each reconnect.
 */
export class ReconnectingMcpClient {
  private client: Client | null = null;
  private tools: McpTool[] = [];

  constructor(private readonly url: string, private readonly log: Logger) {}

  async connect(): Promise<void> {
    await this.doConnect();
  }

  getTools(): McpTool[] { return this.tools; }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.withReconnect(async (c) => {
      const r = await c.callTool({ name, arguments: args });
      return { content: (r.content ?? []) as unknown[], isError: r.isError as boolean | undefined };
    });
  }

  async close(): Promise<void> {
    if (this.client) await this.client.close().catch(() => { /* noop */ });
    this.client = null;
  }

  private async doConnect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(this.url));
    const client = new Client({ name: 'harness', version: '0.1.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    this.client = client;
    this.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    this.log.event('mcp_connected', { url: this.url, toolCount: this.tools.length });
  }

  private async withReconnect<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      if (!this.client) await this.reconnectWithBackoff();
      try {
        return await fn(this.client!);
      } catch (e) {
        this.log.event('mcp_error', { error: String((e as Error).message ?? e) });
        await this.client?.close().catch(() => { /* noop */ });
        this.client = null;
        attempt++;
        if (attempt > 10) throw e;
      }
    }
  }

  private async reconnectWithBackoff(): Promise<void> {
    const delays = [1000, 2000, 4000, 8000, 16000, 30000];
    let i = 0;
    const prevNames = this.tools.map(t => t.name).sort().join(',');
    while (true) {
      try {
        await this.doConnect();
        const newNames = this.tools.map(t => t.name).sort().join(',');
        if (prevNames && prevNames !== newNames) {
          this.log.event('mcp_tools_changed', { before: prevNames, after: newNames });
          this.log.stdout(`mcp: tool set changed after reconnect`);
        }
        return;
      } catch (e) {
        const delay = delays[Math.min(i, delays.length - 1)];
        this.log.event('mcp_reconnect_failed', { attempt: i, delay, error: String((e as Error).message ?? e) });
        this.log.stdout(`mcp: reconnect failed, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        i++;
      }
    }
  }
}
