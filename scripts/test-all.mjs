// `npm test`: the three passes of the suite, each in its own process and with its own HTML report.
// They cannot be one `playwright test` run: the perf budgets are measured alone, and the real-session
// projects must start right after their setup (the saved JWT lives 300 s). Every pass runs even when
// an earlier one fails, so one red pass never hides the state of the others; the exit code is non-zero
// if any pass failed. Extra arguments (a --grep, --workers) are passed to every pass.
import { spawnSync } from 'node:child_process';

const PASSES = [
  { name: 'browsers', projects: ['chromium', 'firefox', 'webkit', 'mobile'] },
  { name: 'perf', projects: ['perf'] },
  { name: 'sessions', projects: ['account', 'admin'] },
];
const extra = process.argv.slice(2);

const results = PASSES.map(({ name, projects }) => {
  console.log(`\n=== ${name}: ${projects.join(', ')} ===`);
  const run = spawnSync('npx', ['playwright', 'test', ...projects.map((p) => `--project=${p}`), ...extra], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report/${name}`, PLAYWRIGHT_HTML_OPEN: 'never' },
  });
  return { name, code: run.status ?? 1 };
});

console.log('\n' + results.map(({ name, code }) => `${code === 0 ? 'passed' : 'FAILED'}  ${name} (exit ${code})`).join('\n'));
process.exit(results.some(({ code }) => code !== 0) ? 1 : 0);
