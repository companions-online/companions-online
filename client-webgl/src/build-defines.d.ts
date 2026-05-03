// Build-time define exposed by esbuild's `define` config (see
// build-shared.ts::readBuildNumber + build.ts/dev.ts/dev-standalone.ts).
//
// The build pipeline reads `.build-number` (incremented by the vitest
// global setup) and inlines the integer at bundle time. Test (vitest)
// runs don't set this — code that reads it must guard with
// `typeof __BUILD_VERSION__ !== 'undefined'`.

declare const __BUILD_VERSION__: number;
