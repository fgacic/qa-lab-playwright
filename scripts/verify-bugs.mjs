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
// - fixed: it passed, twice (the run, then a rerun alone): the site fixed the defect. Update the pin, docs/COVERAGE.md and the bug list.
// - fails for another reason: a precondition, a locator, a timeout, a teardown error. Such a pin is
//   run once more before it is reported, so one slow moment does not fail the gate; a pin that
//   reproduces on the rerun is listed as flaky rather than as reproducing.
// - a pin that PASSED is rerun the same way: a pin that passes once and reproduces on the rerun is a race that was lost
//   (it is how BUG-46 reached main), so it is reported as flaky, not as a fix.
// - mixed: the pin reproduces in one project and passes in another. The defect is engine-specific or the pin is a race.
// Every project that schedules a pin verifies it (a pin in chromium, firefox and webkit runs three times), because an
// engine that is never verified here is only judged by the e2e job, which can say red but not why.
// - flaky / skipped / not run: the pin could not be verified.
// Which pins exist comes from the config (`--list`), not from a hard-coded project list, so a pin in
// any project must be verified here or the script fails. The exception is the `@live-only` pins:
// they are not scheduled on this target, and are printed as "not verifiable on this target".
// The perf pins run in a pass of their own (the perf project is measured alone).
// `--project=<name>` (repeatable) verifies only the pins that project schedules; `--skip-project=<name>` (repeatable) leaves a project out.
// The CI job runs one shard per engine and one for every other project, so no single job takes the whole hour. With neither flag every
// project is verified. A filter that leaves no pin is an error, not a green run.
// Exit 1 on any problem, or when no pin ran. Used by the verify-bugs CI job and `npm run test:verify-bugs`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterRerun, escapeRegExp, judge, strip } from './lib/pin-verdict.mjs';

const BROWSER_OF = { firefox: 'firefox', webkit: 'webkit' };

// Which projects this run verifies (see the header): `--project=a --project=b`, `--skip-project=c`.
const only = [];
const skip = [];
for (const arg of process.argv.slice(2)) {
  const [, flag, name] = /^--(project|skip-project)=(.+)$/.exec(arg) ?? [];
  if (!flag) {
    console.error(`verify-bugs: unknown argument ${arg} (use --project=<name> or --skip-project=<name>)`);
    process.exit(1);
  }
  (flag === 'project' ? only : skip).push(name);
}
const wanted = (project) => (only.length === 0 || only.includes(project)) && !skip.includes(project);

// Playwright empties test-results/ at the start of every run, so each pass writes its report here instead.
const work = mkdtempSync(join(tmpdir(), 'verify-bugs-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

// The command that runs Playwright. `VERIFY_BUGS_PLAYWRIGHT` replaces it with a node script that stands in for it:
// the one seam tests/framework/verify-bugs.spec.ts uses to drive this orchestration (rerun, live-only listing, the perf pass)
// without running a real suite. Never set outside that test.
const RUNNER = process.env.VERIFY_BUGS_PLAYWRIGHT ? [process.execPath, [process.env.VERIFY_BUGS_PLAYWRIGHT]] : ['npx', ['playwright']];

/**
 * Runs `npx playwright test ...args` and returns its JSON report. Stale output never survives: it is deleted first.
 * `--max-failures=0` because CI=true makes the config stop a run after 30 failures, and every pin that reproduces is a failure here.
 */
function playwright(args, name, env = {}) {
  const out = join(work, name);
  const run = spawnSync(RUNNER[0], [...RUNNER[1], 'test', ...args, '--reporter=json', '--max-failures=0', `--output=${join(work, 'artifacts')}`], {
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

// 1. What is scheduled on this target. A pin is verified in every project that schedules it.
const scheduled = new Map(); // specId -> { spec, projects: [] }
for (const spec of pins(playwright(['--list', '--grep', '@bug'], 'list.json'))) {
  const entry = scheduled.get(specId(spec)) ?? { spec, projects: [] };
  entry.projects.push(...spec.tests.map((t) => t.projectName));
  scheduled.set(specId(spec), entry);
}
const verifyIn = new Map(); // key -> project
for (const [, { spec, projects }] of scheduled) {
  for (const project of new Set(projects)) if (wanted(project)) verifyIn.set(keyOf(spec, project), project);
}
const projectsToRun = [...new Set(verifyIn.values())];

// A pin scheduled in firefox or webkit needs that browser. CI installs all three before this runs (the verify-bugs job); this is the
// safety net for a local run: a no-op when present, instead of a run that fails with "Executable doesn't exist" and a misleading verdict.
// Never with a stand-in runner (VERIFY_BUGS_PLAYWRIGHT): nothing then opens a browser, and parallel installs fight over apt's dpkg lock (exit 100).
const browsersNeeded = process.env.VERIFY_BUGS_PLAYWRIGHT ? [] : [...new Set(projectsToRun.map((p) => BROWSER_OF[p]).filter(Boolean))];
for (const browser of browsersNeeded) {
  console.log(`making sure ${browser} is installed: a known-bug spec is scheduled there`);
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

// 4. Judge each pin. A pin that passed, or failed for another reason, is run once more, alone: neither a lucky moment nor a
// slow one decides the gate.
const reproduces = [];
const fixed = [];
const other = [];
const notVerified = [];
let rerun = 0;
const verdicts = new Map(); // specId -> [{ r, verdict }]
for (const key of verifyIn.keys()) {
  const r = results.find((x) => x.key === key);
  if (!r) {
    notVerified.push(`${key}: it is scheduled but produced no result`);
    continue;
  }
  let verdict = judge(r);
  if (verdict.other || verdict.fixed) {
    rerun += 1;
    const again = collect(playwright(
      [`--project=${r.project}`, '--grep', escapeRegExp(r.title), r.specFile, '--retries=0', '--workers=1'],
      `rerun-${rerun}.json`,
      { VERIFY_BUGS: '1' },
    )).find((x) => x.key === key);
    const second = again ? judge(again) : undefined;
    verdict = afterRerun(verdict, second);
  }
  const id = key.slice(0, key.lastIndexOf(' ['));
  verdicts.set(id, [...(verdicts.get(id) ?? []), { r, verdict }]);
}
for (const entries of verdicts.values()) {
  const reproducing = entries.filter((e) => e.verdict.reproduces);
  const passing = entries.filter((e) => e.verdict.fixed);
  if (reproducing.length && passing.length) {
    // One pin, two engines, two answers: say so once, instead of a "fixed?" that is only true somewhere.
    notVerified.push(`${entries[0].r.specFile} › ${entries[0].r.title}: mixed, it reproduces in ${reproducing.map((e) => e.r.project).join(', ')} but passes in ${passing.map((e) => e.r.project).join(', ')}`);
    for (const e of entries) if (!e.verdict.reproduces && !e.verdict.fixed) notVerified.push(`${e.r.label}: ${e.verdict.notVerified ?? e.verdict.other}`);
    continue;
  }
  for (const { r, verdict } of entries) {
    if (verdict.notVerified) notVerified.push(`${r.label}: ${verdict.notVerified}`);
    else if (verdict.fixed) fixed.push(r.label);
    else if (verdict.other) other.push(`${r.label}: ${verdict.other}`);
    else reproduces.push(r.label);
  }
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
