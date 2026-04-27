import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CONFIG_DIR } from './paths.js';
import { loadConfig, type ModelConfig } from './config.js';
import { loadEnv } from './env.js';
import { createLogger, type Logger } from './logger.js';
import { ReconnectingMcpClient } from './mcp-client.js';
import { OpenRouterClient } from './openrouter.js';
import { createDispatcher, type ToolDispatcher } from './dispatcher.js';
import { buildHarnessTools } from './harness-tools.js';
import { openScratchpad, type Scratchpad } from './scratchpad.js';
import { OpenRouterDecider, type Decider } from './decider.js';

export type { ModelConfig } from './config.js';

export interface BootstrapOpts {
  configName: string;
  configDir?: string;
  logger?: Logger;
  decider?: Decider;
  memory?: Scratchpad;
  sessionId?: string;
}

export interface Bootstrap {
  config: ModelConfig;
  system: string;
  first: string;
  mcp: ReconnectingMcpClient;
  dispatcher: ToolDispatcher;
  decider: Decider;
  memory: Scratchpad;
  log: Logger;
  sessionId: string;
}

function loadPrompt(configDir: string): { system: string; first: string } {
  const raw = readFileSync(join(configDir, 'prompt.md'), 'utf8');
  const idx = raw.indexOf('\n---\n');
  if (idx === -1) return { system: raw.trim(), first: '' };
  return { system: raw.slice(0, idx).trim(), first: raw.slice(idx + 5).trim() };
}

// Sentinel: when configName === 'human', the CLI is running the TTY UI and
// no model JSON is required. The decider is supplied externally; the OpenRouter
// branch is never taken, so the model field is never read off this stub.
const HUMAN_STUB_CONFIG: ModelConfig = { type: 'model', model: 'human', actionWindowSize: 20 };

export async function bootstrapHarness(opts: BootstrapOpts): Promise<Bootstrap> {
  loadEnv();

  const configDir = opts.configDir ?? CONFIG_DIR;
  const config = opts.configName === 'human'
    ? HUMAN_STUB_CONFIG
    : loadConfig<ModelConfig>(opts.configName, 'model', configDir);
  const { system, first } = loadPrompt(configDir);

  const sessionId = opts.sessionId ?? randomUUID();
  const log = opts.logger ?? createLogger(sessionId);
  const memory = opts.memory ?? openScratchpad(sessionId);
  const mcpUrl = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
  const mcp = new ReconnectingMcpClient(mcpUrl, log);
  await mcp.connect();

  const harnessTools = buildHarnessTools(memory);
  const dispatcher = createDispatcher(mcp, harnessTools);

  let decider = opts.decider;
  if (!decider) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
    const { type: _t, model: _m, actionWindowSize: _a, ...extra } = config;
    const client = new OpenRouterClient({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL });
    decider = new OpenRouterDecider(client, { model: config.model, ...extra });
  }

  log.stdout(`harness: session=${sessionId} model=${config.model} mcp=${mcpUrl}`);
  log.stdout(`harness: memory=${memory.path}`);
  log.event('start', { sessionId, config, mcpUrl, memoryPath: memory.path });

  return { config, system, first, mcp, dispatcher, decider, memory, log, sessionId };
}
