import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, runPath, logPath } from '../helpers/paths.js';
import { loadEnv } from '../helpers/env.js';
import { loadConfig, type ModelConfig } from '../helpers/config.js';
import { OpenRouterClient, type ChatMessage } from '../helpers/openrouter.js';
import { OpenRouterDecider } from '../helpers/decider.js';

interface RunFile {
  llmConfigName: string;
}

interface RequestEvent {
  step: number;
  messages: ChatMessage[];
  tools: unknown[];
}

function readLastRequest(runId: string): RequestEvent {
  const file = logPath(runId);
  const raw = readFileSync(file, 'utf8');
  let last: RequestEvent | null = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: { kind?: string; data?: unknown };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind === 'request' && entry.data) last = entry.data as RequestEvent;
  }
  if (!last) throw new Error(`no request events in ${file}`);
  return last;
}

async function main(): Promise<void> {
  const runId = process.argv[2];
  const llmConfigArg = process.argv[3];
  if (!runId) {
    process.stderr.write('usage: tsx harness/eval/survey.ts <runId> [llmConfigName]\n');
    process.exit(1);
  }

  loadEnv();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const runJsonPath = runPath(runId);
  let llmConfigName: string;
  if (existsSync(runJsonPath)) {
    const run = JSON.parse(readFileSync(runJsonPath, 'utf8')) as RunFile;
    if (!run.llmConfigName) throw new Error(`run ${runId} missing llmConfigName`);
    llmConfigName = run.llmConfigName;
  } else if (llmConfigArg) {
    llmConfigName = llmConfigArg;
  } else {
    throw new Error(`no run.json at ${runJsonPath}; pass llmConfigName as second arg`);
  }

  const lastReq = readLastRequest(runId);
  const messages: ChatMessage[] = [...lastReq.messages];

  // Only illegal trailing shape is assistant(tool_calls) with no tool response.
  // A trailing tool message is fine — we can append the survey user turn after it.
  const tail = messages[messages.length - 1];
  if (tail && tail.role === 'assistant' && tail.tool_calls && tail.tool_calls.length > 0) {
    messages.pop();
  }

  const surveyText = readFileSync(join(CONFIG_DIR, 'survey.md'), 'utf8');
  messages.push({ role: 'user', content: surveyText });

  const config = loadConfig<ModelConfig>(llmConfigName, 'model');
  const { type: _t, model: _m, actionWindowSize: _a, ...extra } = config;
  const client = new OpenRouterClient({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL });
  const decider = new OpenRouterDecider(client, { model: config.model, ...extra });

  process.stderr.write(`survey: runId=${runId} model=${config.model} messages=${messages.length}\n`);

  const { message, usage } = await decider.decide({ messages, tools: [] });

  if (message.reasoning) {
    process.stdout.write(`--- reasoning ---\n${message.reasoning}\n--- response ---\n`);
  }
  process.stdout.write(`${message.content ?? ''}\n`);

  if (usage) {
    process.stderr.write(`tokens: in=${usage.prompt_tokens} out=${usage.completion_tokens} total=${usage.total_tokens}\n`);
  }
}

main().catch(e => {
  process.stderr.write(`error: ${(e as Error).message ?? e}\n`);
  process.exit(1);
});
