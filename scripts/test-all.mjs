// `npm test`: the passes of the suite, each in its own process and with its own HTML report.
// They cannot be one `playwright test` run: the perf budgets are measured alone, and the real-session
// projects must start right after their setup (the saved JWT lives 300 s). Every pass runs even when
// an earlier one fails, so one red pass never hides the state of the others; the exit code is non-zero
// if any pass failed. Extra arguments are appended to every pass's `playwright test` command line, after its own
// --project flags: `npm test -- --grep @smoke` greps every pass, `npm test -- --workers=2` caps every pass, a test file
// path narrows every pass to it, and `--project=x` adds x to every pass (so it does not select one pass: run
// `npx playwright test --project=x` for that). A pass in which they select nothing is skipped, not failed.
// Ctrl-C stops the pass that is running, skips the ones not started yet, prints the summary of what finished, and exits 130.
// The projects of each pass are the ones the config defines on this target (`TARGET=live` has no
// account or admin project unless opted in), and a pass in which the extra arguments select no test
// is reported as skipped, not failed.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PASSES = [
  { name: 'browsers', projects: ['chromium', 'firefox', 'webkit', 'mobile'] },
  { name: 'framework', projects: ['framework'] },
  { name: 'perf', projects: ['perf'] },
  { name: 'lockout', projects: ['lockout'] }, // the sign-in burst (SEC-17): no other sign-in may share its address while it runs
  { name: 'sessions', projects: ['account', 'admin'] },
];
const extra = process.argv.slice(2);

/** The names of the projects the config defines for this TARGET. */
function configuredProjects() {
  const dir = mkdtempSync(join(tmpdir(), 'test-all-'));
  try {
    const out = join(dir, 'list.json');
    const run = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
    });
    if (run.error || run.signal) throw new Error(`could not run Playwright: ${run.error?.message ?? `killed by ${run.signal}`}`);
    return new Set(JSON.parse(readFileSync(out, 'utf8')).config.projects.map((p) => p.name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs one pass, streaming its output as it comes and keeping a copy to look for "No tests found". */
let running; // the pass in flight, so Ctrl-C can stop it
let interrupted = false;

function runPass(projects, name) {
  return new Promise((resolve) => {
    let output = '';
    const child = running = spawn('npx', ['playwright', 'test', ...projects.map((p) => `--project=${p}`), ...extra], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report/${name}`, PLAYWRIGHT_HTML_OPEN: 'never' },
    });
    // Only the tail matters (the message comes when nothing ran), so the copy stays small however long the run.
    const forward = (stream, sink) => stream.on('data', (chunk) => { sink.write(chunk); output = (output + chunk).slice(-4096); });
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.on('error', () => resolve({ code: 1, output }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

// The terminal sends SIGINT to the whole foreground group, so the running pass already got it; this keeps the script alive
// long enough to print what finished, instead of dying with no summary.
process.on('SIGINT', () => {
  interrupted = true;
  running?.kill('SIGINT');
});

const defined = configuredProjects();
const results = [];
for (const { name, projects: wanted } of PASSES) {
  if (interrupted) {
    results.push({ name, code: 1, notRun: true });
    continue;
  }
  const projects = wanted.filter((p) => defined.has(p));
  if (!projects.length) {
    console.log(`\n=== ${name}: no such project on this target, skipped ===`);
    results.push({ name, code: 0, skipped: true });
    continue;
  }
  console.log(`\n=== ${name}: ${projects.join(', ')} ===`);
  const { code, output } = await runPass(projects, name);
  // `--grep` and friends can leave a pass with nothing to run; Playwright exits 1 for that, which is not a failure of the suite.
  if (code !== 0 && /No tests found/.test(output)) results.push({ name, code: 0, skipped: true });
  else results.push({ name, code });
}

const label = ({ code, skipped, notRun }) => (notRun ? 'not run' : skipped ? 'skipped' : code === 0 ? 'passed' : 'FAILED');
console.log('\n' + (interrupted ? 'Interrupted.\n' : '') + results.map((r) => `${label(r)}  ${r.name}${r.skipped || r.notRun ? '' : ` (exit ${r.code})`}`).join('\n'));
process.exit(interrupted ? 130 : results.some(({ code }) => code !== 0) ? 1 : 0);
