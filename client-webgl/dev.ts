import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ctx = await esbuild.context({
  entryPoints: [path.resolve(__dirname, 'src/main.ts')],
  bundle: true,
  outdir: path.resolve(__dirname, 'dist'),
  sourcemap: true,
  format: 'esm',
  logLevel: 'info',
  plugins: [{
    name: 'shared-alias',
    setup(build) {
      build.onResolve({ filter: /^@shared\// }, (args) => {
        const rel = args.path.slice('@shared/'.length).replace(/\.js$/, '');
        return { path: path.resolve(__dirname, '..', 'shared', 'src', rel + '.ts') };
      });
    },
  }],
});

const { host, port } = await ctx.serve({
  servedir: path.resolve(__dirname),
  port: 3001,
});

console.log(`[client-gl] http://localhost:${port}`);
