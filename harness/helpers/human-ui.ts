import * as readline from 'node:readline';
import type { OpenAITool } from './dispatcher.js';

export type ToolPick =
  | { kind: 'tool'; tool: OpenAITool }
  | { kind: 'inline'; text: string };

export interface UI {
  /** Show a tool selector; up-arrow at index 0 switches to inline-text entry. */
  pickTool(tools: OpenAITool[], initialIndex?: number): Promise<ToolPick>;
  /** Prompt for each property on the tool's JSON-schema object. */
  promptParams(tool: OpenAITool): Promise<Record<string, unknown>>;
  /** Read a single line (used for inline say). */
  readLine(prompt: string): Promise<string>;
  close(): void;
}

export function createUI(
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
): UI {
  return {
    pickTool: (tools, initialIndex) => pickTool(stdin, stdout, tools, initialIndex ?? 0),
    promptParams: (tool) => promptParams(stdin, stdout, tool),
    readLine: (prompt) => readLine(stdin, stdout, prompt),
    close() { /* readline is opened per-call */ },
  };
}

async function pickTool(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  tools: OpenAITool[],
  initialIndex: number,
): Promise<ToolPick> {
  // If stdin isn't a real TTY (tests), fall back to line-based selection.
  const tty = (stdin as NodeJS.ReadStream).isTTY;
  if (!tty) return pickToolLineMode(stdin, stdout, tools);

  let index = Math.min(Math.max(0, initialIndex), tools.length - 1);
  const render = () => {
    stdout.write('\n--- Select tool (↑/↓ to move, Enter to pick, Up at top = inline say) ---\n');
    for (let i = 0; i < tools.length; i++) {
      const t = tools[i].function;
      const cursor = i === index ? '>' : ' ';
      stdout.write(`${cursor} ${t.name}  ${t.description ? `— ${oneLine(t.description, 80)}` : ''}\n`);
    }
  };
  const clear = () => {
    const total = tools.length + 1; // include header line
    for (let i = 0; i < total; i++) stdout.write('\x1b[1A\x1b[2K');
  };

  render();

  return new Promise<ToolPick>((resolve, reject) => {
    const stream = stdin as NodeJS.ReadStream;
    stream.setRawMode?.(true);
    stream.resume();

    const onData = (buf: Buffer) => {
      const s = buf.toString('utf8');
      // Ctrl+C
      if (s === '\x03') {
        cleanup();
        reject(new Error('SIGINT'));
        return;
      }
      // Up
      if (s === '\x1b[A') {
        if (index === 0) {
          cleanup();
          readLine(stdin, stdout, 'Inline say: ').then(text => resolve({ kind: 'inline', text }), reject);
          return;
        }
        index--;
        clear(); render();
        return;
      }
      // Down
      if (s === '\x1b[B') {
        if (index < tools.length - 1) { index++; clear(); render(); }
        return;
      }
      // Enter
      if (s === '\r' || s === '\n') {
        cleanup();
        resolve({ kind: 'tool', tool: tools[index] });
        return;
      }
    };

    const cleanup = () => {
      stream.setRawMode?.(false);
      stream.removeListener('data', onData);
      stream.pause();
    };

    stream.on('data', onData);
  });
}

/** Fallback for non-TTY (tests, piped stdin). */
async function pickToolLineMode(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  tools: OpenAITool[],
): Promise<ToolPick> {
  stdout.write('\nTools:\n');
  stdout.write('  -1: (inline say)\n');
  for (let i = 0; i < tools.length; i++) {
    stdout.write(`  ${i}: ${tools[i].function.name}\n`);
  }
  const line = await readLine(stdin, stdout, 'Pick index: ');
  const n = parseInt(line.trim(), 10);
  if (n === -1) {
    const text = await readLine(stdin, stdout, 'Inline say: ');
    return { kind: 'inline', text };
  }
  if (isNaN(n) || n < 0 || n >= tools.length) throw new Error(`bad index: ${line}`);
  return { kind: 'tool', tool: tools[n] };
}

async function promptParams(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  tool: OpenAITool,
): Promise<Record<string, unknown>> {
  const schema = (tool.function.parameters ?? {}) as {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  const props = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) {
    const type = prop.type ?? 'any';
    const raw = await readLine(stdin, stdout, `  ${name} (${type})${prop.description ? ` — ${oneLine(prop.description, 60)}` : ''}: `);
    if (raw === '') continue;
    out[name] = coerce(raw, type);
  }
  return out;
}

function coerce(raw: string, type: string): unknown {
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return /^(true|yes|1|y)$/i.test(raw);
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function readLine(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  prompt: string,
): Promise<string> {
  const rl = readline.createInterface({
    input: stdin as NodeJS.ReadStream,
    output: stdout as NodeJS.WriteStream,
    terminal: (stdin as NodeJS.ReadStream).isTTY ?? false,
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.question(prompt, (answer) => resolve(answer));
      rl.on('close', () => resolve(''));
      rl.on('error', reject);
    });
  } finally {
    rl.close();
  }
}

function oneLine(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}
