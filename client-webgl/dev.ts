import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeAliasPlugin, readBuildNumber } from './build-shared.js';

// Watch-mode build. The game server (server/src/main.ts) serves
// client-webgl/ as static files same-origin on its own port, so this script
// does not open a dev server — it just rebuilds dist/main.js on change.

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
console.log('[client-gl] watching src/ — rebuilds on change. Server serves client-webgl/ at its own port.');
