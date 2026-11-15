// Runs every knownBug() spec as an ordinary test (VERIFY_BUGS=1) and checks that each one still
// reproduces its bug. The contract (src/support/known-bug.ts): a pin "still reproduces" only if it
// failed AND its last error message names the pin's id, because the bug assertion's message starts
// with it. Three outcomes:
// - passed: the site fixed the defect. Update the pin, docs/COVERAGE.md and the bug list.
// - failed without its id: the pin broke for another reason (a precondition, a locator, a timeout).
// - failed with its id: still reproduces, as pinned.
// Exit 1 on the first two, or when no pin ran. Used by the verify-bugs CI job and `npm run test:verify-bugs`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const out = 'test-results/verify-bugs.json';
spawnSync('npx', ['playwright', 'test', '--project=chromium', '--project=admin', '--project=perf', '--grep', '@bug', '--retries=0', '--reporter=json'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, VERIFY_BUGS: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: out },
});

const report = JSON.parse(readFileSync(out, 'utf8'));
const ANSI = /\u001b\[[0-9;]*m/g;
const results = [];
const walk = (suite) => {
  // Only the pins: setup projects run too, as dependencies of the admin project.
  for (const spec of suite.specs ?? []) {
    if (!spec.tags?.includes('bug')) continue;
    for (const t of spec.tests) {
      const last = t.results.at(-1);
      const pin = t.annotations?.find((a) => a.type === 'known bug');
      const id = pin?.description?.match(/^([A-Za-z0-9_-]+):/)?.[1];
      const message = (last?.errors ?? [last?.error]).filter(Boolean).map((e) => e.message ?? '').join('\n').replace(ANSI, '');
      results.push({
        title: `${spec.file} › ${spec.title}`,
        status: last?.status,
        skipped: t.status === 'skipped',
        id,
        namesId: !!id && message.includes(id),
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
report.suites.forEach(walk);

const checked = results.filter((r) => !r.skipped);
const fixed = checked.filter((r) => r.status === 'passed');
const failed = checked.filter((r) => r.status !== 'passed');
const reproducing = failed.filter((r) => r.namesId);
const otherReason = failed.filter((r) => !r.namesId);

console.log(`${checked.length} known-bug specs ran: ${reproducing.length} still reproduce, ${fixed.length} fixed, ${otherReason.length} fail for another reason.`);
for (const r of fixed) console.log(`  fixed? ${r.title}`);
for (const r of otherReason) console.log(`  fails for another reason (${r.id ? `no "${r.id}" in its error` : 'no known bug annotation'}): ${r.title}`);
if (!checked.length) console.log('  no known-bug spec ran: the grep or the projects are wrong');
process.exit(fixed.length || otherReason.length || !checked.length ? 1 : 0);
