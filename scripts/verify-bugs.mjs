// Runs every knownBug() spec as an ordinary test (VERIFY_BUGS=1) and checks that each one still
// reproduces its bug. The contract (src/support/known-bug.ts): `test.fail` accepts any failure, so
// this script is what makes a pin mean something. A pin "still reproduces" only if
// - it failed in its test body: every error it reported is located in the spec file (a fixture
//   teardown that threw, e.g. a refused write or a failed cleanup, is not the bug);
// - every error names the pin's id, because the bug assertion's message starts with it (a
//   precondition or locator failure never carries it);
// - every error is assertion-shaped (`expect(...)`), not a test timeout or a closed page;
// - and the bug assertion's locator resolved to something: "element(s) not found" is a missing
//   element, not a wrong value, and its message still carries the id. A pin for a defect that IS an
//   absence (a missing heading, a button that is never rendered) opts in with
//   `knownBug(id, summary, { absence: true })`, which adds an annotation this script reads.
// Outcomes:
// - reproduces: failed as pinned.
// - fixed: it passed, the site fixed the defect. Update the pin, docs/COVERAGE.md and the bug list.
// - fails for another reason: a precondition, a locator, a timeout, a teardown error. Such a pin is
//   run once more before it is reported, so one slow moment does not fail the gate; a pin that
//   reproduces on the rerun is listed as flaky rather than as reproducing.
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

// eslint-disable-next-line no-control-regex -- the escape character is what an ANSI colour sequence starts with
const ANSI = /\u001b\[[0-9;]*m/g;
const strip = (text) => (text ?? '').replace(ANSI, '');
// When a pin is scheduled in several projects, it is verified in the first of these that has it.
// A pin scheduled only in firefox or webkit is verified there, after installing that browser (see below).
const PREFERRED = ['chromium', 'admin', 'account', 'firefox', 'webkit', 'mobile', 'perf'];
const rank = (project) => (PREFERRED.includes(project) ? PREFERRED.indexOf(project) : PREFERRED.length);

/** The id as a whole word: "BUG-1" must not be found in "BUG-12: ...". */
const mentions = (message, id) => new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(message);
const BROWSER_OF = { firefox: 'firefox', webkit: 'webkit' };

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

// A pin that only firefox or webkit schedules needs that browser: install it now (a no-op when present),
// instead of letting the run fail with "Executable doesn't exist" and a misleading verdict.
for (const browser of new Set(projectsToRun.map((p) => BROWSER_OF[p]).filter(Boolean))) {
  console.log(`installing ${browser}: a known-bug spec is scheduled only there`);
  // --with-deps: a bare CI runner lacks the browser's system libraries as well as the browser.
  const install = spawnSync('npx', ['playwright', 'install', '--with-deps', browser], { stdio: 'inherit' });
  if (install.status !== 0) fail(`could not install ${browser}, which a known-bug spec needs (try: npx playwright install --with-deps ${browser})`);
}

// 2. The pins the live target would add (@live-only), which no local run can verify.
const liveOnly = new Set();
{
  const live = playwright(['--list', '--grep', '@bug'], 'live-list.json', { TARGET: 'live' });
  for (const spec of pins(live)) if (!scheduled.has(specId(spec))) liveOnly.add(`${spec.file} › ${spec.title}`);
}

// 3. Run them: everything but perf together, perf alone.
/** The result of each scheduled pin in `report` that is verified in the project it ran in. */
function collect(report) {
  const found = [];
  for (const spec of pins(report)) {
    for (const t of spec.tests) {
      const key = keyOf(spec, t.projectName);
      if (verifyIn.get(key) !== t.projectName || found.some((r) => r.key === key)) continue; // verified in another project, or already seen
      const last = t.results.at(-1);
      const errors = (last?.errors?.length ? last.errors : last?.error ? [last.error] : []).map((e) => ({ message: strip(e.message), file: e.location?.file }));
      const annotation = (type) => t.annotations?.find((a) => a.type === type);
      const id = annotation('known bug')?.description?.match(/^([A-Za-z0-9_-]+):/)?.[1];
      found.push({
        key, label: labelOf(spec, t.projectName), specFile: spec.file, title: spec.title, project: t.projectName,
        status: t.status, last: last?.status, id, absence: !!annotation('known bug absence'), errors,
      });
    }
  }
  return found;
}

const results = [];
const passes = [
  { projects: projectsToRun.filter((p) => p !== 'perf'), out: 'run.json' },
  { projects: projectsToRun.filter((p) => p === 'perf'), out: 'perf.json' },
].filter((pass) => pass.projects.length);
for (const { projects, out } of passes) {
  const report = playwright([...projects.map((p) => `--project=${p}`), '--grep', '@bug', '--retries=0'], out, { VERIFY_BUGS: '1' });
  results.push(...collect(report));
}

// 4. Judge each pin.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reproduces = [];
const fixed = [];
const other = [];
const notVerified = [];
/** The verdict for one result: 'reproduces', 'fixed', or a problem line. */
function judge(r) {
  if (r.status === 'skipped' || r.last === 'skipped') return { notVerified: 'skipped' };
  if (r.status === 'flaky') return { notVerified: 'flaky (passed on a retry), so it cannot be trusted either way' };
  if (r.last === 'passed') return { fixed: true };
  if (!r.id) return { other: 'no known-bug annotation, so no id to look for' };
  const problem = whyNotThePin(r);
  return problem ? { other: problem } : { reproduces: true };
}
let rerun = 0;
for (const key of verifyIn.keys()) {
  const r = results.find((x) => x.key === key);
  if (!r) {
    notVerified.push(`${key}: it is scheduled but produced no result`);
    continue;
  }
  let verdict = judge(r);
  if (verdict.other) {
    // Once more, alone: a pin that failed for another reason is often one slow moment, and the gate should say which.
    rerun += 1;
    const again = collect(playwright(
      [`--project=${r.project}`, '--grep', escapeRegExp(r.title), r.specFile, '--retries=0', '--workers=1'],
      `rerun-${rerun}.json`,
      { VERIFY_BUGS: '1' },
    )).find((x) => x.key === key);
    const second = again ? judge(again) : undefined;
    if (second?.reproduces) verdict = { notVerified: `failed for another reason, then reproduced on a rerun (${verdict.other}): flaky` };
    else if (second?.fixed) verdict = { notVerified: `failed for another reason, then passed on a rerun (${verdict.other}): flaky` };
    else if (second?.other) verdict = { other: `${verdict.other} (the same on a rerun)` };
  }
  if (verdict.notVerified) notVerified.push(`${r.label}: ${verdict.notVerified}`);
  else if (verdict.fixed) fixed.push(r.label);
  else if (verdict.other) other.push(`${r.label}: ${verdict.other}`);
  else reproduces.push(r.label);
}

/**
 * Whether a failed locator expectation never found its element. Playwright's message says so in two ways: the
 * received value is `<element(s) not found>`, or the call log shows it waiting for the locator and never
 * "resolved to" anything. (A count or a hidden element still resolves, so a bug about those is not caught here.)
 */
function matchedNoElement(message) {
  if (!/expect\(locator\)/.test(message)) return false;
  if (/Received[^\n]*<element\(s\) not found>/.test(message)) return true;
  return /^\s*- waiting for /m.test(message) && !/resolved to/.test(message);
}

/** Why a failed pin is not the pinned bug, or undefined when it is. */
function whyNotThePin({ id, errors, specFile, last, absence }) {
  if (last === 'timedOut') return 'the test timed out';
  if (!errors.length) return `failed with no error message`;
  for (const [i, { message, file }] of errors.entries()) {
    const where = i === 0 ? 'the test body' : `error ${i + 1}`;
    if (!mentions(message, id)) return `${where} does not name "${id}": ${firstLine(message)}`;
    if (!/expect\(/.test(message) || /Test timeout of|Target (page, context or browser|closed)|has been closed/.test(message)) {
      return `${where} names "${id}" but is not an assertion failure: ${firstLine(message)}`;
    }
    if (!absence && matchedNoElement(message)) return `${where} names "${id}" but its locator matched no element, which proves nothing about the bug: add a precondition that the element exists (or pin an absence with { absence: true })`;
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
