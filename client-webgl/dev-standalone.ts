// Watch + serve dev mode for the standalone (no-server) client build.
//
// Boots esbuild's built-in static server with servedir=client-webgl/ so
// /index-standalone.html, /dist/main.js, and /assets/* are served from one
// origin. Standalone mode is selected at runtime when the served HTML does
// NOT inject `window.GAME_SERVER_HOST` — see network/standalone-connection.ts.
//
// For networked dev, the game server (server/src/main.ts) serves the same
// client-webgl/ tree at its own port — use `npm run dev` for that path.

import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeAliasPlugin, readBuildNumber } from './build-shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ctx = await esbuild.context({
  entryPoints: [path.resolve(__dirname, 'src/main.ts')],
  bundle: true,
  outdir: path.resolve(__dirname, 'dist'),
  sourcemap: true,
  format: 'esm',
  logLevel: 'info',
  define: { __BUILD_VERSION__: JSON.stringify(readBuildNumber(__dirname)) },
  plugins: [makeAliasPlugin(__dirname)],
});

await ctx.watch();

const port = Number(process.env.PORT ?? 3002);
const { host, port: actualPort } = await ctx.serve({
  servedir: __dirname,
  port,
  host: '127.0.0.1',
});

console.log(`[client-gl standalone] serving http://${host}:${actualPort}/index-standalone.html`);
