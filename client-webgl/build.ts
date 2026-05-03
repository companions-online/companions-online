import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeAliasPlugin, readBuildNumber } from './build-shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src/main.ts')],
  bundle: true,
  outdir: path.resolve(__dirname, 'dist'),
  sourcemap: true,
  format: 'esm',
  minify: true,
  define: { __BUILD_VERSION__: JSON.stringify(readBuildNumber(__dirname)) },
  plugins: [makeAliasPlugin(__dirname)],
});

console.log('[client-gl] build complete');
