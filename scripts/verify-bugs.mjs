// Runs every knownBug() spec as an ordinary test (VERIFY_BUGS=1) and checks that each one still
// reproduces its bug. The contract (src/support/known-bug.ts): `test.fail` accepts any failure, so
// this script is what makes a pin mean something. A pin "still reproduces" only if
// - it failed in its test body: every error it reported is located in the spec file (a fixture
//   teardown that threw, e.g. a refused write or a failed cleanup, is not the bug);
// - every error names the pin's id, because the bug assertion's message starts with it (a
//   precondition or locator failure never carries it);
// - and every error is assertion-shaped (`expect(...)`), not a test timeout or a closed page.
// Outcomes:
// - reproduces: failed as pinned.
// - fixed: it passed, the site fixed the defect. Update the pin, docs/COVERAGE.md and the bug list.
// - fails for another reason: a precondition, a locator, a timeout, a teardown error.
// - flaky / skipped / not run: the pin could not be verified.
// Which pins exist comes from the config (`--list`), not from a hard-coded project list, so a pin in
// any project must be verified here or the script fails. The exception is the `@live-only` pins:
// they are not scheduled on this target, and are printed as "not verifiable on this target".
// The perf pins run in a pass of their own (the perf project is measured alone).
// Exit 1 on any problem, or when no pin ran. Used by the verify-bugs CI job and `npm run test:verify-bugs`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ANSI = /\u001b\[[0-9;]*m/g;
const strip = (text) => (text ?? '').replace(ANSI, '');
// When a pin is scheduled in several projects, it is verified in the first of these that has it.
const PREFERRED = ['chromium', 'admin', 'account', 'firefox', 'webkit', 'mobile', 'perf'];
const rank = (project) => (PREFERRED.includes(project) ? PREFERRED.indexOf(project) : PREFERRED.length);

// Playwright empties test-results/ at the start of every run, so each pass writes its report here instead.
const work = mkdtempSync(join(tmpdir(), 'verify-bugs-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

/** Runs `npx playwright test ...args` and returns its JSON report. Stale output never survives: it is deleted first. */
function playwright(args, name, env = {}) {
  const out = join(work, name);
  const run = spawnSync('npx', ['playwright', 'test', ...args, '--reporter=json', `--output=${join(work, 'artifacts')}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
  });
  // A failing test exits 1, which is expected here. No signal and no report mean the run never started (a fresh directory, so no stale report can stand in).
  if (run.error || run.signal) fail(`could not run Playwright: ${run.error?.message ?? `killed by ${run.signal}`}`);
  let report;
  try {
    report = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    fail(`Playwright exited ${run.status} without writing its report: the config probably failed to load (see above).`);
  }
  if (report.errors?.length) fail(`Playwright reported errors: ${report.errors.map((e) => strip(e.message).split('\n')[0]).join('; ')}`);
  return report;
}

function fail(message) {
  console.error(`verify-bugs: ${message}`);
  process.exit(1);
}

/** Every spec tagged @bug in a report, with its tests. */
function pins(report) {
  const found = [];
  const walk = (suite) => {
    // Only the pins: setup projects run too, as dependencies of the admin and account projects.
    for (const spec of suite.specs ?? []) if (spec.tags?.includes('bug')) found.push(spec);
    for (const child of suite.suites ?? []) walk(child);
  };
  report.suites.forEach(walk);
  return found;
}

// Loops make several specs on one line, so the title is part of the identity.
const specId = (spec) => `${spec.file}:${spec.line} ${spec.title}`;
const keyOf = (spec, project) => `${specId(spec)} [${project}]`;
const labelOf = (spec, project) => `${spec.file} › ${spec.title} [${project}]`;

// 1. What is scheduled on this target, and where each pin is verified.
const scheduled = new Map(); // specId -> { spec, projects: [] }
for (const spec of pins(playwright(['--list', '--grep', '@bug'], 'list.json'))) {
  const entry = scheduled.get(specId(spec)) ?? { spec, projects: [] };
  entry.projects.push(...spec.tests.map((t) => t.projectName));
  scheduled.set(specId(spec), entry);
}
const verifyIn = new Map(); // key -> project
for (const [, { spec, projects }] of scheduled) {
  const project = [...new Set(projects)].sort((a, b) => rank(a) - rank(b))[0];
  verifyIn.set(keyOf(spec, project), project);
}
const projectsToRun = [...new Set(verifyIn.values())];

// 2. The pins the live target would add (@live-only), which no local run can verify.
const liveOnly = new Set();
{
  const live = playwright(['--list', '--grep', '@bug'], 'live-list.json', { TARGET: 'live' });
  for (const spec of pins(live)) if (!scheduled.has(specId(spec))) liveOnly.add(`${spec.file} › ${spec.title}`);
}

// 3. Run them: everything but perf together, perf alone.
const results = [];
const passes = [
  { projects: projectsToRun.filter((p) => p !== 'perf'), out: 'run.json' },
  { projects: projectsToRun.filter((p) => p === 'perf'), out: 'perf.json' },
].filter((pass) => pass.projects.length);
for (const { projects, out } of passes) {
  const report = playwright([...projects.map((p) => `--project=${p}`), '--grep', '@bug', '--retries=0'], out, { VERIFY_BUGS: '1' });
  for (const spec of pins(report)) {
    for (const t of spec.tests) {
      const key = keyOf(spec, t.projectName);
      if (verifyIn.get(key) !== t.projectName || results.some((r) => r.key === key)) continue; // verified in another project, or already seen
      const last = t.results.at(-1);
      const errors = (last?.errors?.length ? last.errors : last?.error ? [last.error] : []).map((e) => ({ message: strip(e.message), file: e.location?.file }));
      const id = t.annotations?.find((a) => a.type === 'known bug')?.description?.match(/^([A-Za-z0-9_-]+):/)?.[1];
      results.push({ key, label: labelOf(spec, t.projectName), specFile: spec.file, status: t.status, last: last?.status, id, errors });
    }
  }
}

// 4. Judge each pin.
const reproduces = [];
const fixed = [];
const other = [];
const notVerified = [];
for (const key of verifyIn.keys()) {
  const r = results.find((x) => x.key === key);
  if (!r) {
    notVerified.push(`${key}: it is scheduled but produced no result`);
    continue;
  }
  if (r.status === 'skipped' || r.last === 'skipped') notVerified.push(`${r.label}: skipped`);
  else if (r.status === 'flaky') notVerified.push(`${r.label}: flaky (passed on a retry), so it cannot be trusted either way`);
  else if (r.last === 'passed') fixed.push(r.label);
  else if (!r.id) other.push(`${r.label}: no known-bug annotation, so no id to look for`);
  else {
    const problem = whyNotThePin(r);
    if (problem) other.push(`${r.label}: ${problem}`);
    else reproduces.push(r.label);
  }
}

/** Why a failed pin is not the pinned bug, or undefined when it is. */
function whyNotThePin({ id, errors, specFile, last }) {
  if (last === 'timedOut') return 'the test timed out';
  if (!errors.length) return `failed with no error message`;
  for (const [i, { message, file }] of errors.entries()) {
    const where = i === 0 ? 'the test body' : `error ${i + 1}`;
    if (!message.includes(id)) return `${where} does not name "${id}": ${firstLine(message)}`;
    if (!/expect\(/.test(message) || /Test timeout of|Target (page, context or browser|closed)|has been closed/.test(message)) {
      return `${where} names "${id}" but is not an assertion failure: ${firstLine(message)}`;
    }
    if (file && !file.endsWith(specFile)) return `${where} came from ${file.split('/').slice(-2).join('/')} (a fixture or teardown), not from the spec`;
  }
  return undefined;
}
function firstLine(message) {
  return message.split('\n').find((line) => line.trim()) ?? '';
}

mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/verify-bugs.json', JSON.stringify({ reproduces, fixed, other, notVerified, liveOnly: [...liveOnly] }, null, 2));

console.log(
  `${verifyIn.size} known-bug specs scheduled, ${results.length} ran: ${reproduces.length} still reproduce, ${fixed.length} fixed, ${other.length} fail for another reason, ${notVerified.length} could not be verified.`,
);
for (const r of fixed) console.log(`  fixed? ${r}`);
for (const r of other) console.log(`  fails for another reason: ${r}`);
for (const r of notVerified) console.log(`  not verified: ${r}`);
for (const r of liveOnly) console.log(`  not verifiable on this target (@live-only): ${r}`);
if (!verifyIn.size) console.log('  no known-bug spec is scheduled: the grep or the projects are wrong');
process.exit(fixed.length || other.length || notVerified.length || !results.length ? 1 : 0);
