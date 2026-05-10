// Shared esbuild plumbing for the client-webgl build/dev scripts.
// Resolves three monorepo source-tree aliases:
//
//   @shared/*       → ../shared/src/*.ts
//   @server/*       → ../server/src/*.ts
//   @client-webgl/* → ./src/*.ts        (self — symmetric with @server/@shared)
//
// `@server` resolution is what lets the in-tab observer boot path (see
// network/standalone-connection.ts) bundle a GameWorld + GameLoop into the
// browser bundle. The @client-webgl self-alias is harmless and keeps the
// import surface symmetric between the three trees.

import * as esbuild from 'esbuild';
import path from 'path';
import { readFileSync } from 'node:fs';

interface AliasSpec {
  prefix: string;
  resolveTo: (rest: string) => string;
}

function buildAliases(repoRoot: string): AliasSpec[] {
  return [
    { prefix: '@shared/',       resolveTo: (r) => path.resolve(repoRoot, 'shared',       'src', r + '.ts') },
    { prefix: '@server/',       resolveTo: (r) => path.resolve(repoRoot, 'server',       'src', r + '.ts') },
    { prefix: '@client-webgl/', resolveTo: (r) => path.resolve(repoRoot, 'client-webgl', 'src', r + '.ts') },
  ];
}

/** Read the integer in `<repoRoot>/.build-number`. The file is bumped by
 *  the vitest global setup (scripts/vitest-global-setup.ts) on each test
 *  run, so production builds embed whatever the last test run left. Falls
 *  back to 0 if the file is missing — keeps dev iteration unblocked. */
export function readBuildNumber(clientWebglDir: string): number {
  const repoRoot = path.resolve(clientWebglDir, '..');
  try {
    const raw = readFileSync(path.resolve(repoRoot, '.build-number'), 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function makeAliasPlugin(clientWebglDir: string): esbuild.Plugin {
  const repoRoot = path.resolve(clientWebglDir, '..');
  const aliases = buildAliases(repoRoot);
  return {
    name: 'client-webgl-aliases',
    setup(build) {
      for (const { prefix, resolveTo } of aliases) {
        const filter = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        build.onResolve({ filter }, (args) => {
          const rel = args.path.slice(prefix.length).replace(/\.js$/, '');
          return { path: resolveTo(rel) };
        });
      }
    },
  };
}
