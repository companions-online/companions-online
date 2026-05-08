#!/usr/bin/env -S npx tsx
import { loadCharactersConfig } from '../helpers/characters-config.js';
import { createCharacterRows, runCharacters } from '../helpers/run-characters.js';
import { startDashboard, printFinalSummary } from '../helpers/characters-dashboard.js';

async function main(): Promise<void> {
  const characters = loadCharactersConfig();
  if (characters.length === 0) {
    console.error('characters config is empty');
    process.exit(2);
  }

  const ac = new AbortController();
  process.on('SIGINT', () => {
    ac.abort();
  });

  const rows = createCharacterRows(characters);
  const dashboard = startDashboard(rows);

  let exitCode = 0;
  try {
    const result = await runCharacters(characters, rows, { abortSignal: ac.signal });
    if (result.failures.length > 0) {
      exitCode = 1;
      // Stash failures to write *after* dashboard tear-down to keep the TUI
      // clean during the run.
      process.on('exit', () => {
        for (const f of result.failures) {
          process.stderr.write(`[${f.name}] ${f.error.message}\n`);
        }
      });
    }
  } finally {
    dashboard.stop();
    printFinalSummary(rows);
  }
  process.exit(exitCode);
}

await main();
