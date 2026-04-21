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
  if (transport.sessionId) saveSession(transport.sessionId);
  return client;
}

function isStaleSessionError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? '';
  return /unknown session/i.test(msg);
}

// --- Raw TTY key channel ---

type KeyResolver = (key: string) => void;
const keyWaiters: KeyResolver[] = [];
const keyBuffer: string[] = [];
let ttyInitialized = false;

// Split a raw stdin chunk into individual "keys". Escape sequences (CSI like
// \x1b[A) are kept together; everything else is delivered one char at a time
// so that pasted / batched input (e.g. "test\r") isn't dropped as one oversize
// token.
function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === '\x1b' && chunk[i + 1] === '[' && i + 2 < chunk.length) {
      keys.push(chunk.slice(i, i + 3));
      i += 3;
    } else {
      keys.push(chunk[i]);
      i += 1;
    }
  }
  return keys;
}

function onStdinData(chunk: string) {
  for (const key of splitKeys(chunk)) {
    if (key === '\x03') { // Ctrl+C: exit
      cleanupTty();
      process.exit(0);
    }
    if (keyWaiters.length > 0) {
      keyWaiters.shift()!(key);
    } else {
      keyBuffer.push(key);
    }
  }
}

function nextKey(): Promise<string> {
  if (keyBuffer.length > 0) return Promise.resolve(keyBuffer.shift()!);
  return new Promise(res => keyWaiters.push(res));
}

function initTty() {
  if (ttyInitialized) return;
  ttyInitialized = true;
  process.stdin.setRawMode!(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onStdinData);
}

function cleanupTty() {
  if (!ttyInitialized) return;
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?25h'); // show cursor
}

// --- Prompt primitives ---

async function selectFromList(
  title: string,
  items: { label: string; description?: string }[],
): Promise<number | null> {
  let cursor = 0;
  const height = items.length + 2; // title + items + trailing blank

  // Truncate to one terminal row so the fixed-height redraw math works even
  // when a description would otherwise wrap.
  const fit = (s: string, cols: number): string =>
    s.length <= cols ? s : s.slice(0, Math.max(0, cols - 1)) + '…';

  const render = (firstTime: boolean) => {
    if (!firstTime) process.stdout.write(`\x1b[${height}A`);
    process.stdout.write('\r\x1b[J');
    const cols = process.stdout.columns ?? 80;
    process.stdout.write(fit(title, cols) + '\n');
    for (let i = 0; i < items.length; i++) {
      const prefix = i === cursor ? '> ' : '  ';
      const desc = items[i].description ? ` — ${items[i].description}` : '';
      process.stdout.write(fit(`${prefix}${items[i].label.padEnd(22)}${desc}`, cols) + '\n');
    }
    process.stdout.write('\n');
  };

  process.stdout.write('\x1b[?25l'); // hide cursor
  render(true);
  try {
    while (true) {
      const k = await nextKey();
      if (k === '\x1b' || k === 'q') return null;
      if (k === '\r' || k === '\n') return cursor;
      if (k === '\x1b[A' && cursor > 0) { cursor--; render(false); }
      else if (k === '\x1b[B' && cursor < items.length - 1) { cursor++; render(false); }
    }
  } finally {
    process.stdout.write('\x1b[?25h');
  }
}

// Returns null on ESC, empty string on bare Enter.
async function readLine(prompt: string): Promise<string | null> {
  process.stdout.write('\x1b[?25h');
  process.stdout.write(prompt);
  let buf = '';
  while (true) {
    const k = await nextKey();
    if (k === '\x1b') { process.stdout.write('\n'); return null; }
    if (k === '\r' || k === '\n') { process.stdout.write('\n'); return buf; }
    if (k === '\x7f' || k === '\b') {
      if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
    } else if (k.length === 1 && k >= ' ') {
      buf += k;
      process.stdout.write(k);
    }
  }
}

async function waitForEnter(prompt: string): Promise<void> {
  process.stdout.write(prompt);
  while (true) {
    const k = await nextKey();
    if (k === '\r' || k === '\n') { process.stdout.write('\n'); return; }
  }
}

// --- Param coercion ---

type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

function coerce(raw: string, type: string | undefined): CoerceResult {
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    if (raw === '' || isNaN(n) || !isFinite(n)) return { ok: false, error: 'not a valid number' };
    if (type === 'integer' && !Number.isInteger(n)) return { ok: false, error: 'expected an integer' };
    return { ok: true, value: n };
  }
  if (type === 'boolean') {
    const l = raw.toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(l)) return { ok: true, value: true };
    if (['false', '0', 'no', 'n'].includes(l)) return { ok: true, value: false };
    return { ok: false, error: 'expected true/false' };
  }
  return { ok: true, value: raw };
}

async function collectArgs(tool: any): Promise<Record<string, unknown> | null> {
  const props = tool.inputSchema?.properties as
    | Record<string, { type?: string; description?: string }>
    | undefined;
  const required: string[] = tool.inputSchema?.required ?? [];
  const args: Record<string, unknown> = {};
  if (!props) return args;

  for (const [name, schema] of Object.entries(props)) {
    const isRequired = required.includes(name);
    const type = schema.type;
    while (true) {
      const label = `  ${name} (${type ?? 'any'}${isRequired ? '' : ', optional'}): `;
      const raw = await readLine(label);
      if (raw === null) return null; // ESC → back to menu
      if (raw === '') {
        if (!isRequired) break; // skip optional
        process.stdout.write('  (required)\n');
        continue;
      }
      const c = coerce(raw, type);
      if (!c.ok) { process.stdout.write(`  (${c.error})\n`); continue; }
      args[name] = c.value;
      break;
    }
  }
  return args;
}

// --- Main loop ---

async function callAndPrint(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  for (const block of result.content as any[]) {
    if (block.type === 'text') console.log(block.text);
  }
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('mcp-client requires an interactive TTY (stdin is not a TTY)');
    process.exit(1);
  }

  // Initial connect + listTools. With a pre-set sessionId the SDK skips
  // initialize, so a stale session doesn't fail on connect() — it fails on the
  // first real call (listTools). Match mcp.ts: on stale, clear and retry fresh.
  let client: Client;
  let tools: Awaited<ReturnType<Client['listTools']>>['tools'];
  const existing = readSession();
  try {
    client = await connect(existing);
    ({ tools } = await client.listTools());
  } catch (e) {
    if (existing && isStaleSessionError(e)) {
      clearSession();
      client = await connect(undefined);
      ({ tools } = await client.listTools());
    } else {
      throw e;
    }
  }
  let items = tools.map(t => ({ label: t.name, description: t.description ?? '' }));

  initTty();
  process.on('exit', cleanupTty);

  const title = 'Select MCP tool (↑/↓, Enter, Esc/q to quit):';

  while (true) {
    const idx = await selectFromList(title, items);
    if (idx === null) {
      await client.close().catch(() => { /* noop */ });
      cleanupTty();
      return;
    }
    const tool = tools[idx];
    process.stdout.write(`\n${tool.name}${tool.description ? ` — ${tool.description}` : ''}\n`);

    const args = await collectArgs(tool);
    if (args === null) { process.stdout.write('\n'); continue; }

    try {
      await callAndPrint(client, tool.name, args);
    } catch (e: any) {
      console.log(`Error: ${e?.message ?? e}`);
      if (isStaleSessionError(e)) {
        await waitForEnter('Session expired. Press Enter to reconnect... ');
        clearSession();
        await client.close().catch(() => { /* noop */ });
        client = await connect(undefined);
        ({ tools } = await client.listTools());
        items = tools.map(t => ({ label: t.name, description: t.description ?? '' }));
      }
    }
    process.stdout.write('\n');
  }
}

main().catch(e => { cleanupTty(); console.error(e?.message ?? e); process.exit(1); });
