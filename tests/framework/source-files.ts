import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** Every `.ts` file under `dir` (relative to the repository root), as a path relative to it. */
export function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}
