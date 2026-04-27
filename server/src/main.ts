import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { TICK_RATE, AUTOSAVE_WORLD_TICKS } from '@shared/constants.js';
import { gameMinuteFromTick } from '@shared/lighting.js';
import { GameLoop } from './ecs/game-loop.js';
import { renderDashboard, type DashboardState } from './dashboard.js';
import { createApp } from './app.js';
import { getSessionCount } from './mcp/session.js';
import { saveWorld, loadWorld, createNewWorld } from './world-persistence.js';
import { dumpWorld } from './world-dump.js';
import type { GameWorld } from './game-world.js';

const PORT = parseInt(process.env.PORT ?? '', 10) || 3001;
const WORLD_SEED = parseInt(process.env.SEED ?? '', 10) || 42;
const DATA_DIR = './data';

// --- Parse CLI args ---
function parseArgs(): { worldId?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--world' && args[i + 1]) return { worldId: args[i + 1] };
  }
  return {};
}

// --- Boot ---
async function main() {
  const { worldId: loadId } = parseArgs();

  let world: GameWorld;
  let worldId: string;
  let worldDir: string;
  let meta: Awaited<ReturnType<typeof loadWorld>>['meta'];

  if (loadId) {
    worldDir = `${DATA_DIR}/worlds/${loadId}`;
    console.log(`[server] loading world ${loadId}...`);
    const loaded = await loadWorld(worldDir);
    world = loaded.world;
    meta = loaded.meta;
    worldId = meta.worldId;
    console.log(`[server] world loaded: ${world.entities.getEntityCount()} entities (tick ${meta.tick})`);
  } else {
    console.log(`[server] generating new world (seed=${WORLD_SEED})...`);
    const created = await createNewWorld(WORLD_SEED, DATA_DIR);
    world = created.world;
    worldId = created.worldId;
    worldDir = created.worldDir;
    meta = created.meta;
    console.log(`[server] world created: ${world.entities.getEntityCount()} entities`);
    console.log(`[server] world id: ${worldId}`);
  }

  const telemetry = world.telemetry;

  // --- Create Hono app ---
  const { app, wsUpgrade, getWsConnectionCount } = createApp(world, telemetry);

  // --- Dashboard state ---
  const dashState: DashboardState = {
    worldId,
    paused: false,
    saveStatus: '',
    currentTimeOfDay: '--:--',
  };

  function formatTimeOfDay(w: GameWorld): string {
    const m = gameMinuteFromTick(w.effectiveTick);
    const h = Math.floor(m / 60);
    const mm = Math.floor(m % 60);
    return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }
  let saveFlashTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Save helper ---
  let saving = false;
  async function doSave() {
    if (saving) return;
    saving = true;
    dashState.saveStatus = 'saving';
    try {
      await saveWorld(world, worldDir, meta);
    } catch (err) {
      console.error('[server] save failed:', err);
    } finally {
      saving = false;
      dashState.saveStatus = 'saved';
      if (saveFlashTimer) clearTimeout(saveFlashTimer);
      saveFlashTimer = setTimeout(() => { dashState.saveStatus = ''; }, 3000);
    }
  }

  // --- Game loop ---
  const loop = new GameLoop(TICK_RATE);

  loop.start((tick, _dt) => {
    if (dashState.paused) {
      // Still render dashboard while paused, but don't tick the world
      if (tick % TICK_RATE === 0) {
        dashState.currentTimeOfDay = formatTimeOfDay(world);
        renderDashboard(telemetry.snapshot(), dashState);
        telemetry.resetNetworkCounters();
      }
      return;
    }

    telemetry.setConnectionCount('ws', getWsConnectionCount());
    telemetry.setConnectionCount('mcp', getSessionCount());
    world.runTick();

    // Autosave
    if (tick % AUTOSAVE_WORLD_TICKS === 0 && tick > 0) {
      doSave();
    }

    if (tick % TICK_RATE === 0) {
      dashState.currentTimeOfDay = formatTimeOfDay(world);
      renderDashboard(telemetry.snapshot(), dashState);
      telemetry.resetNetworkCounters();
    }
  });

  process.stdout.write('\x1b[2J\x1b[H');

  // --- Keyboard handler ---
  if (!process.stdin.isTTY) {
    console.log('[server] stdin is not a TTY — dashboard keys (s/p/q/d) disabled. ' +
      'Run the server standalone (`npm run dev:server`) to enable keys.');
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', async (key: string) => {
      if (key === 'q' || key === '\x03') { // q or Ctrl-C
        console.log('\n[server] saving and shutting down...');
        loop.stop();
        await doSave();
        await world.log.close();
        process.exit(0);
      }
      if (key === 's') {
        doSave();
      }
      if (key === 'p') {
        dashState.paused = !dashState.paused;
      }
      if (key === 'd') {
        try {
          const filepath = await dumpWorld(world, worldDir);
          const name = filepath.split('/').pop() ?? filepath;
          dashState.saveStatus = `dumped ${name}`;
          world.log.info('world dumped', { filepath });
          if (saveFlashTimer) clearTimeout(saveFlashTimer);
          saveFlashTimer = setTimeout(() => { dashState.saveStatus = ''; }, 3000);
        } catch (err) {
          console.error('[server] dump failed:', err);
          world.log.error('world dump failed', { error: String(err) });
        }
      }
    });
  }

  // --- Graceful shutdown (non-TTY, e.g. Docker) ---
  const shutdown = async () => {
    console.log('\n[server] shutting down...');
    loop.stop();
    await doSave();
    await world.log.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // --- Start HTTP server ---
  const httpServer = serve({ fetch: app.fetch, port: PORT });

  // Disable Node's per-request timeouts. Defaults (requestTimeout=5min,
  // headersTimeout=1min) kill long-lived MCP SSE streams, which we need to
  // stay up for the entire playing session. See docs/plans/mcp-server-keepalive.md.
  const nodeServer = httpServer as import('http').Server;
  nodeServer.requestTimeout = 0;
  nodeServer.headersTimeout = 0;

  // --- Attach WebSocket server ---
  const wss = new WebSocketServer({ server: nodeServer, path: '/ws' });
  wss.on('connection', (ws) => wsUpgrade(ws));
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
