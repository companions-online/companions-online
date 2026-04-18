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

  // SDK skips the initialize handshake when transport.sessionId is pre-set
  // (it assumes reconnect). Save whatever ID ended up on the transport so the
  // next invocation can try to resume.
  if (transport.sessionId) saveSession(transport.sessionId);

  return client;
}

function isStaleSessionError(e: unknown): boolean {
  // Server returns 404 with "Unknown session" when the session ID isn't live.
  const msg = (e as { message?: string })?.message ?? '';
  return /unknown session/i.test(msg);
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

async function runCommand(client: Client, toolName: string | undefined, toolArgs: Record<string, unknown>) {
  if (!toolName) {
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
    return;
  }
  const result = await client.callTool({ name: toolName, arguments: toolArgs });
  for (const block of result.content as any[]) {
    if (block.type === 'text') console.log(block.text);
  }
}

async function runWithSession(sessionId: string | undefined, toolName: string | undefined, toolArgs: Record<string, unknown>) {
  const client = await connect(sessionId);
  try {
    await runCommand(client, toolName, toolArgs);
  } finally {
    await client.close().catch(() => { /* noop */ });
  }
}

async function main() {
  const toolName = process.argv[2];
  const toolArgs = parseArgs(process.argv.slice(3));
  const existingSession = readSession();

  try {
    await runWithSession(existingSession, toolName, toolArgs);
  } catch (e: any) {
    // With a pre-set sessionId the SDK skips initialize, so a stale session
    // doesn't fail inside connect() — it fails on the first real call. Clear
    // and retry with a fresh initialize.
    if (existingSession && isStaleSessionError(e)) {
      clearSession();
      await runWithSession(undefined, toolName, toolArgs);
      return;
    }
    throw e;
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
