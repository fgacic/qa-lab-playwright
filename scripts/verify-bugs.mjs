// Runs every knownBug() spec as an ordinary test (VERIFY_BUGS=1) and checks that each one still
// fails. A spec that passes means the site fixed that defect: the pin, docs/COVERAGE.md and the
// bug list need updating. Used by the verify-bugs CI job and `npm run test:verify-bugs`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const out = 'test-results/verify-bugs.json';
spawnSync('npx', ['playwright', 'test', '--project=chromium', '--project=admin', '--grep', '@bug', '--retries=0', '--reporter=json'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, VERIFY_BUGS: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: out },
});

const report = JSON.parse(readFileSync(out, 'utf8'));
const results = [];
const walk = (suite) => {
  // Only the pins: setup projects run too, as dependencies of the admin project.
  for (const spec of suite.specs ?? []) {
    if (!spec.tags?.includes('bug')) continue;
    for (const t of spec.tests) results.push({ title: `${spec.file} › ${spec.title}`, status: t.results.at(-1)?.status, skipped: t.status === 'skipped' });
  }
  for (const child of suite.suites ?? []) walk(child);
};
report.suites.forEach(walk);

const checked = results.filter((r) => !r.skipped);
const fixed = checked.filter((r) => r.status === 'passed');
console.log(`${checked.length} known-bug specs ran: ${checked.length - fixed.length} still fail as pinned, ${fixed.length} pass.`);
for (const r of fixed) console.log(`  fixed? ${r.title}`);
process.exit(fixed.length ? 1 : 0);
