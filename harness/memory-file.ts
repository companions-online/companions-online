import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface MemoryFile {
  path: string;
  read(): string;
  update(content: string): void;
}

export function openMemoryFile(sessionId: string, dir = 'harness/memory'): MemoryFile {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.md`);
  if (!existsSync(path)) writeFileSync(path, '', 'utf8');
  return {
    path,
    read() { return readFileSync(path, 'utf8'); },
    update(content: string) { writeFileSync(path, content, 'utf8'); },
  };
}
