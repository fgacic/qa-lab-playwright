// scripts/verify-bugs.mjs orchestrates real Playwright runs: which pins exist, where each is verified, the rerun of a pin that failed
// for another reason, the perf pass of its own and the live-only listing. The verdicts are table-tested in pin-verdict.spec.ts; this
// drives the orchestration itself, against a stand-in for Playwright (tests/framework/probe/fake-playwright.mjs) that answers from a scenario.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

interface Pin {
  file: string;
  line: number;
  title: string;
  id: string;
  projects: string[];
  onLive?: true;
  runs: ('reproduces' | 'fixed' | 'other')[];
  runsByProject?: Record<string, ('reproduces' | 'fixed' | 'other')[]>;
  noResult?: true;
}
interface Call { args: string[]; listing: boolean; live: boolean; projects: string[]; rerun: boolean; env: { VERIFY_BUGS?: string } }
interface Outcome { status: number | null; stdout: string; stderr: string; calls: Call[]; summary: Record<string, string[]> }

const pin = (title: string, over: Partial<Pin> = {}): Pin => ({ file: 'tests/x/x.spec.ts', line: 10, title, id: 'PIN-1', projects: ['chromium'], runs: ['reproduces'], ...over });

/** Runs verify-bugs.mjs against the stand-in, in a directory of its own (it writes test-results/ there). */
function verify(pins: Pin[], runErrors?: string[], argv: string[] = []): Outcome {
  const dir = mkdtempSync(join(tmpdir(), 'verify-bugs-spec-'));
  try {
    const scenario = join(dir, 'scenario.json');
    const log = join(dir, 'calls.jsonl');
    writeFileSync(scenario, JSON.stringify({ pins, runErrors }));
    writeFileSync(log, '');
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-bugs.mjs'), ...argv], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, VERIFY_BUGS_PLAYWRIGHT: join(ROOT, 'tests', 'framework', 'probe', 'fake-playwright.mjs'), FAKE_PLAYWRIGHT_SCENARIO: scenario, FAKE_PLAYWRIGHT_LOG: log },
    });
    expect(run.error, 'verify-bugs started').toBeUndefined();
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Call);
    // Written only when the run got as far as judging the pins.
    const summaryFile = join(dir, 'test-results', 'verify-bugs.json');
    const summary = existsSync(summaryFile) ? (JSON.parse(readFileSync(summaryFile, 'utf8')) as Record<string, string[]>) : {};
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, calls, summary };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('verify-bugs orchestration', { tag: ['@framework'] }, () => {
  test('pins that reproduce pass the gate, and the perf pins run in a pass of their own, after the others', () => {
    const outcome = verify([pin('first'), pin('second', { line: 20, projects: ['admin'] }), pin('measured', { line: 30, projects: ['perf'] })]);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain('3 known-bug specs scheduled, 3 ran: 3 still reproduce, 0 fixed, 0 fail for another reason, 0 could not be verified.');
    const runs = outcome.calls.filter((call) => !call.listing);
    expect(runs.map((call) => call.projects.slice().sort()), 'one pass for every project but perf, then perf alone').toEqual([['admin', 'chromium'], ['perf']]);
    expect(runs.every((call) => call.env.VERIFY_BUGS === '1'), 'pins run as ordinary tests').toBe(true);
    expect(outcome.summary.reproduces).toHaveLength(3);
  });

  test('every Playwright call lifts the config\'s CI failure cap, so more than 30 reproducing pins still all run', () => {
    const outcome = verify([pin('first'), pin('second', { line: 20 })]);
    expect(outcome.calls.length).toBeGreaterThan(2);
    for (const call of outcome.calls) expect(call.args, 'a listing and every run').toContain('--max-failures=0');
  });

  test('a report that carries errors fails the gate with the first line of the message', () => {
    const outcome = verify([pin('first')], ['Error: config exploded\n    at somewhere']);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('verify-bugs: Playwright reported errors: Error: config exploded');
  });

  test('a pin that fails for another reason is run once more, alone: reproducing the second time is reported as flaky, not as a pass', () => {
    const outcome = verify([pin('steady'), pin('slow moment', { line: 20, runs: ['other', 'reproduces'] })]);
    expect(outcome.status).toBe(1);
    const reruns = outcome.calls.filter((call) => call.rerun);
    expect(reruns, 'only the pin that failed for another reason is rerun').toHaveLength(1);
    expect(reruns[0].projects).toEqual(['chromium']);
    expect(outcome.stdout).toMatch(/not verified: .*slow moment.*failed for another reason, then reproduced on a rerun .*: flaky/);
    expect(outcome.summary.reproduces).toHaveLength(1);
    expect(outcome.summary.notVerified).toHaveLength(1);
  });

  test('a pin that fails for another reason twice is reported as such, once', () => {
    const outcome = verify([pin('broken precondition', { runs: ['other'] })]);
    expect(outcome.status).toBe(1);
    expect(outcome.calls.filter((call) => call.rerun)).toHaveLength(1);
    expect(outcome.stdout).toMatch(/fails for another reason: .*broken precondition.*\(the same on a rerun\)/);
  });

  test('a pin that is scheduled but produced no result is not verified, and fails the gate', () => {
    const outcome = verify([pin('steady'), pin('vanished', { line: 20, noResult: true })]);
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toMatch(/not verified: .*vanished.*scheduled but produced no result/);
    expect(outcome.summary.notVerified).toHaveLength(1);
  });

  test('a pin that passes twice, the run and a rerun alone, is a fix to record, and fails the gate', () => {
    const outcome = verify([pin('already fixed', { runs: ['fixed'] })]);
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toMatch(/fixed\? .*already fixed/);
    expect(outcome.calls.filter((call) => call.rerun), 'a pass is rerun before it is believed').toHaveLength(1);
    expect(outcome.summary.fixed).toHaveLength(1);
  });

  test('a pin that passes once and reproduces on the rerun is a race that was lost: flaky, not a fix', () => {
    const outcome = verify([pin('lucky', { runs: ['fixed', 'reproduces'] })]);
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toMatch(/not verified: .*lucky.*flaky: passed once, reproduced on rerun/);
    expect(outcome.stdout).not.toMatch(/fixed\?/);
    expect(outcome.summary.fixed).toHaveLength(0);
    expect(outcome.summary.notVerified).toHaveLength(1);
  });

  test('a pin scheduled in several projects is verified in each of them, with its own rerun', () => {
    const outcome = verify([pin('everywhere', { projects: ['chromium', 'firefox', 'webkit'] }), pin('admin only', { line: 20, projects: ['admin'] })]);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain('4 known-bug specs scheduled, 4 ran: 4 still reproduce');
    const runs = outcome.calls.filter((call) => !call.listing);
    expect(runs[0].projects.slice().sort(), 'every scheduled project is run').toEqual(['admin', 'chromium', 'firefox', 'webkit']);
    expect(outcome.summary.reproduces.filter((label) => label.includes('everywhere')).map((label) => label.match(/\[(\w+)\]$/)?.[1]).sort()).toEqual(['chromium', 'firefox', 'webkit']);
  });

  test('--project and --skip-project shard the run: each shard verifies its own projects, and together they verify every pin once', () => {
    const pins = [pin('everywhere', { projects: ['chromium', 'firefox', 'webkit'] }), pin('admin only', { line: 20, projects: ['admin'] }), pin('measured', { line: 30, projects: ['perf'] })];
    const shard = (...argv: string[]) => {
      const outcome = verify(pins, undefined, argv);
      expect(outcome.status, argv.join(' ')).toBe(0);
      return { runs: outcome.calls.filter((call) => !call.listing && !call.rerun).flatMap((call) => call.projects).sort(), reproduces: outcome.summary.reproduces };
    };
    const firefox = shard('--project=firefox');
    expect(firefox.runs).toEqual(['firefox']);
    expect(firefox.reproduces).toHaveLength(1);
    const rest = shard('--skip-project=chromium', '--skip-project=firefox', '--skip-project=webkit');
    expect(rest.runs).toEqual(['admin', 'perf']);
    const together = [shard('--project=chromium'), firefox, shard('--project=webkit'), rest].flatMap((s) => s.reproduces);
    expect(together, 'five verifications in all (three engines, admin, perf), none twice').toHaveLength(5);
    expect(new Set(together).size).toBe(5);
  });

  test('a filter that leaves no pin, or a flag it does not know, fails the gate', () => {
    const none = verify([pin('first')], undefined, ['--project=webkit']);
    expect(none.status).toBe(1);
    expect(none.stdout).toContain('no known-bug spec is scheduled');
    const unknown = verify([pin('first')], undefined, ['--projects=chromium']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown argument --projects=chromium');
  });

  test('a pin that reproduces in one engine and passes in another is reported as mixed, once, and fails the gate', () => {
    const outcome = verify([pin('engine specific', { projects: ['chromium', 'webkit'], runsByProject: { webkit: ['fixed'] } })]);
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toMatch(/not verified: .*engine specific: mixed, it reproduces in chromium but passes in webkit/);
    expect(outcome.stdout).not.toMatch(/fixed\?/);
    expect(outcome.summary.reproduces).toHaveLength(0);
  });

  test('a pin that fails in one engine for another reason is judged there, and the other engines still count', () => {
    const outcome = verify([pin('webkit slow', { projects: ['chromium', 'webkit'], runsByProject: { webkit: ['other'] } })]);
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toMatch(/fails for another reason: .*webkit slow \[webkit\].*\(the same on a rerun\)/);
    expect(outcome.summary.reproduces).toHaveLength(1);
    expect(outcome.calls.filter((call) => call.rerun).map((call) => call.projects)).toEqual([['webkit']]);
  });

  test('a pin only the live target schedules is listed as not verifiable here, and does not fail the gate', () => {
    const outcome = verify([pin('everywhere'), pin('live only', { line: 20, onLive: true })]);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toMatch(/not verifiable on this target \(@live-only\): .*live only/);
    expect(outcome.stdout).toContain('1 known-bug specs scheduled, 1 ran');
    const listings = outcome.calls.filter((call) => call.listing);
    expect(listings.map((call) => call.live), 'the target is listed twice: as it is, then as the live site').toEqual([false, true]);
    expect(outcome.summary.liveOnly).toHaveLength(1);
  });

  test('a run that schedules no pin at all fails, rather than reporting nothing wrong', () => {
    const outcome = verify([]);
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain('no known-bug spec is scheduled');
  });
});
