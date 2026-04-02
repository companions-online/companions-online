import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(__dirname, '.session');
const BASE_URL = process.env.MCP_URL || 'http://localhost:3001/mcp';

function readSession(): string | undefined {
  try { return readFileSync(SESSION_FILE, 'utf8').trim() || undefined; } catch { return undefined; }
}

function saveSession(id: string): void {
  writeFileSync(SESSION_FILE, id, 'utf8');
}

function clearSession(): void {
  try { unlinkSync(SESSION_FILE); } catch { /* noop */ }
}

async function connect(sessionId?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(BASE_URL),
    sessionId ? { sessionId } : undefined,
  );
  const client = new Client({ name: 'mcp-cli', version: '1.0.0' });
  await client.connect(transport);

  // Save new session ID if one was assigned
  const newId = transport.sessionId;
  if (newId) saveSession(newId);

  return client;
}

function parseArgs(argv: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    const key = arg.slice(0, eq);
    const raw = arg.slice(eq + 1);
    // Auto-coerce numbers
    const num = Number(raw);
    args[key] = raw !== '' && !isNaN(num) && isFinite(num) ? num : raw;
  }
  return args;
}

async function main() {
  const toolName = process.argv[2];
  const toolArgs = parseArgs(process.argv.slice(3));

  // Try existing session, fall back to new
  let client: Client;
  const existingSession = readSession();
  try {
    client = await connect(existingSession);
  } catch (e: any) {
    if (existingSession) {
      // Session stale — clear and retry
      clearSession();
      client = await connect();
    } else {
      console.error('Failed to connect:', e.message);
      process.exit(1);
    }
  }

  try {
    if (!toolName) {
      // List tools
      const { tools } = await client.listTools();
      console.log('Available tools:\n');
      for (const tool of tools) {
        const params = tool.inputSchema?.properties
          ? Object.entries(tool.inputSchema.properties as Record<string, any>)
              .map(([k, v]) => `${k}: ${v.type ?? 'any'}`)
              .join(', ')
          : '';
        console.log(`  ${tool.name.padEnd(20)} ${tool.description ?? ''}`);
        if (params) console.log(`  ${''.padEnd(20)}   ${params}`);
      }
    } else {
      // Call tool
      const result = await client.callTool({ name: toolName, arguments: toolArgs });
      for (const block of result.content as any[]) {
        if (block.type === 'text') console.log(block.text);
      }
    }
  } finally {
    await client.close();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
