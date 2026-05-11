import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runEval, type EvalConfig } from '../../eval/eval-runner.js';
import { createTestWorld, addTestPlayer, placeTree } from '../../../test/e2e/helpers.js';
import { BlueprintType } from '../../../shared/src/blueprints.js';
import { createNoopLogger } from '../helpers/noop-logger.js';
import { openScratchpad } from '../../helpers/scratchpad.js';
import type { Decider, DecideInput, DecideResult } from '../../helpers/decider.js';
import type { ChatMessage, TokenUsage } from '../../helpers/openrouter.js';
import type { GameWorld } from '../../../server/src/game-world.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', 'test', 'fixtures');
const llmConfigDir = join(fixturesDir, 'config');

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function makeTmpDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/**
 * Stub decider that emits scripted tool calls turn by turn. After scripted
 * messages run out, defaults to memory_update so the loop keeps going until
 * maxSteps. Reports a fixed usage on each turn.
 */
class ScriptedDecider implements Decider {
  private turn = 0;
  constructor(private readonly script: ChatMessage[], private readonly usage: TokenUsage) {}
  async decide(_input: DecideInput): Promise<DecideResult> {
    const idx = this.turn++;
    const message = this.script[idx] ?? {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `c_${idx}`,
        type: 'function',
        function: { name: 'memory_update', arguments: JSON.stringify({ content: `tick ${idx}` }) },
      }],
    };
    return { message, usage: this.usage };
  }
}

function identifyMsg(turn: number, name: string): ChatMessage {
  return {
    role: 'assistant', content: null,
    tool_calls: [{
      id: `c_${turn}`,
      type: 'function',
      function: { name: 'identify', arguments: JSON.stringify({ name }) },
    }],
  };
}

describe('runEval', () => {
  it('resolves AI eid, accumulates tokens, stops at max_turns, writes result file', async () => {
    const memDir = makeTmpDir('eval-mem-');
    const resultsDir = makeTmpDir('eval-results-');

    const evalConfig: EvalConfig = {
      name: 'plumbing-test',
      harness: 'compact',
      worldSeed: 1,
      maxTurns: 4,
      maxTokens: 1_000_000,
      checkpoints: [
        { id: 'craft_axe', event: 'craft_complete', match: { itemName: 'Axe' } },
      ],
    };

    const decider = new ScriptedDecider(
      [identifyMsg(1, 'evaluator')],
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    );

    const result = await runEval({
      llmConfigName: 'test-model',
      llmConfigDir,
      evalConfig,
      decider,
      worldFactory: () => createTestWorld(),
      logger: createNoopLogger(),
      memory: openScratchpad('eval-test-1', memDir),
      resultsDir,
    });

    expect(result.stopReason).toBe('max_turns');
    expect(result.turnCount).toBe(4);
    expect(result.totalTokens).toBe(15 * 4); // 15 per turn × 4 turns
    expect(result.aiEid).not.toBeNull();
    expect(result.score).toBe(0);
    expect(result.checkpointsHit).toEqual([]);

    expect(existsSync(join(resultsDir, `${result.runId}.json`))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(resultsDir, `${result.runId}.json`), 'utf8'));
    expect(parsed.runId).toBe(result.runId);
    expect(parsed.stopReason).toBe('max_turns');
  });

  it('records a checkpoint hit when the AI harvests a tree', async () => {
    const memDir = makeTmpDir('eval-mem-');
    const resultsDir = makeTmpDir('eval-results-');

    const evalConfig: EvalConfig = {
      name: 'harvest-test',
      harness: 'compact',
      worldSeed: 1,
      maxTurns: 6,
      maxTokens: 1_000_000,
      checkpoints: [
        { id: 'harvest_tree', event: 'harvest_yield', match: { resourceName: 'Wood' } },
      ],
    };

    // We pre-arrange the world: tree placed near spawn, axe will be granted
    // to the AI right after identify creates it. The decider script:
    //   1. identify → spawns AI; world hook then equips axe + places tree.
    //   2. harvest at the tree's tile.
    let aiEid: number | null = null;
    let world: GameWorld;
    let calls = 0;

    const decider: Decider = {
      async decide(_input: DecideInput): Promise<DecideResult> {
        if (aiEid == null) {
          for (const k of world.players.keys()) { aiEid = k; break; }
        }
        const usage = { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 };
        if (calls === 0) {
          calls++;
          return { message: identifyMsg(0, 'evaluator'), usage };
        }
        if (calls === 1) {
          const ai = aiEid!;
          const pos = world.entities.position.get(ai)!;
          world.inventoryMgr.addItem(ai, BlueprintType.Axe, 1);
          const inv = world.inventoryMgr.get(ai)!;
          const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
          world.inventoryMgr.equip(ai, axe.itemId);
          placeTree(world, pos.tileX + 1, pos.tileY);
          calls++;
          return {
            message: {
              role: 'assistant', content: null,
              tool_calls: [{
                id: 'c_1', type: 'function',
                function: { name: 'harvest', arguments: JSON.stringify({ x: pos.tileX + 1, y: pos.tileY }) },
              }],
            },
            usage,
          };
        }
        calls++;
        return {
          message: {
            role: 'assistant', content: null,
            tool_calls: [{
              id: `c_${calls}`, type: 'function',
              function: { name: 'memory_update', arguments: JSON.stringify({ content: 'wait' }) },
            }],
          },
          usage,
        };
      },
    };

    const result = await runEval({
      llmConfigName: 'test-model',
      llmConfigDir,
      evalConfig,
      decider,
      worldFactory: () => { world = createTestWorld(); return world; },
      logger: createNoopLogger(),
      memory: openScratchpad('eval-test-2', memDir),
      resultsDir,
    });

    expect(result.stopReason).toBe('all_checkpoints');
    expect(result.score).toBe(1);
    expect(result.checkpointsHit).toEqual(['harvest_tree']);
    // identify + harvest are real MCP tools, so mcpCalls should be > 0 and APS should be positive.
    expect(result.mcpCallCount).toBeGreaterThanOrEqual(1);
    expect(result.actionsPerSec).toBeGreaterThan(0);
  }, 15_000);

  it('stops on max_tokens when the budget is exhausted', async () => {
    const memDir = makeTmpDir('eval-mem-');
    const resultsDir = makeTmpDir('eval-results-');

    const evalConfig: EvalConfig = {
      name: 'budget-test',
      harness: 'compact',
      worldSeed: 1,
      maxTurns: 100,
      maxTokens: 30, // 3 turns × 10 tokens = 30 → triggers stop on turn 3.
      checkpoints: [],
    };

    const decider = new ScriptedDecider(
      [identifyMsg(1, 'evaluator')],
      { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    );

    const result = await runEval({
      llmConfigName: 'test-model',
      llmConfigDir,
      evalConfig,
      decider,
      worldFactory: () => createTestWorld(),
      logger: createNoopLogger(),
      memory: openScratchpad('eval-test-3', memDir),
      resultsDir,
    });

    expect(result.stopReason).toBe('max_tokens');
    expect(result.turnCount).toBe(3);
    expect(result.totalTokens).toBeGreaterThanOrEqual(30);
  });
});
