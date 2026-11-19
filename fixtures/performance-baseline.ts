import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';

/** The four vitals every measurement and every baseline entry holds (what each one is: fixtures/performance.ts). */
export interface Vitals {
  lcp: number;
  cls: number;
  tbt: number;
  inp: number;
}

/** What a baseline needs to know about a measurement: its key, and its median and spread per metric. */
export interface Measured {
  name: string;
  median: Vitals;
  spread: Vitals;
}

/** The median and the spread (largest minus smallest) of each vital over a measurement's samples, rounded the way the baseline file holds them. */
export function summarise(samples: Vitals[]): { median: Vitals; spread: Vitals } {
  const column = (metric: keyof Vitals) => samples.map((v) => v[metric]);
  const median = (metric: keyof Vitals) => {
    const sorted = [...column(metric)].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const range = (metric: keyof Vitals) => Math.max(...column(metric)) - Math.min(...column(metric));
  return {
    median: { lcp: Math.round(median('lcp')), cls: Number(median('cls').toFixed(3)), tbt: Math.round(median('tbt')), inp: Math.round(median('inp')) },
    spread: { lcp: Math.round(range('lcp')), cls: Number(range('cls').toFixed(3)), tbt: Math.round(range('tbt')), inp: Math.round(range('inp')) },
  };
}

/** A measurement and the metrics of it to record, held until the test has finished (see `record`). */
export interface Recording {
  measurement: Measured;
  metrics: (keyof Vitals)[];
}

/**
 * A baseline-relative limit is the recorded median plus a margin sized by what was measured:
 * the larger of MARGIN_SPREADS times the spread seen across the samples when it was recorded
 * (how much two loads of the same code differ on that machine), MARGIN_SHARE of the median, and
 * the metric's noise floor, but never more than twice that floor (see MARGIN_CAP_FLOORS). The floor is there because a handful of samples understates the
 * spread: 30% of a TBT of 0 is 0, and a single 60 ms task is not a regression, and five samples
 * that agree do not prove the sixth will. The floors are about what two runs of the same code
 * differ by. Measured over three recordings on an idle machine (load average under 4): LCP varied by
 * at most 24 ms per page, TBT not at all, CLS not at all, and the INP proxy between 16 and 24 ms, a single
 * step of event timing, which rounds to 8 ms so a frame can land either side of an input.
 * The INP floor is 32 ms, four of those steps: wide enough for the run-to-run spread, narrow enough to catch a real slide
 * long before the 200 ms budget. The cap is what keeps a noisy recording from blessing its own noise: the INP proxy of a
 * page recorded with a spread of 24 ms would otherwise be allowed 72 ms on top of a median of 16, four times its value, and a
 * slide to 80 ms would pass. With the cap the same page may reach 16 + 64 = 80 ms at most, and a recording that needs more than
 * that is too noisy to be a baseline (record it again on an idle machine) rather than one that deserves a wider margin: the rule
 * is `MARGIN_SPREADS x spread > cap` (see isNoisy), and a metric that breaks it keeps its median in the file but has no baseline
 * ratchet (it is annotated as noisy, and only the spec's fixed limits hold it, which is what they are for). It does not try to absorb a busy machine: a floor widened after a failure under a load
 * average of 11 to 34 (the proxy reached 72 ms) only hides what is wrong with that measurement. Budgets are measured
 * alone on an idle machine, and the baseline is recorded on one (see refusing to record, below).
 */
const MARGIN_SPREADS = 3;
const MARGIN_SHARE = 0.05;
/** The margin never exceeds this many noise floors, whatever the spread of the recording says. */
const MARGIN_CAP_FLOORS = 2;
const NOISE_FLOOR: Vitals = { lcp: 100, cls: 0.02, tbt: 50, inp: 32 };
/** A baseline is recorded only on an idle machine: the one-minute load average must not exceed this. */
const MAX_LOAD_TO_RECORD = 4;

/**
 * Where the medians recorded on the self-hosted shop live, committed with the specs, one set per
 * environment (see baselineEnvironment). Each entry holds, per metric, the median and the spread of the samples.
 * Record them anew, after a deliberate change to the shop or to the throttling, with
 * `UPDATE_PERF_BASELINE=1 npm run test:perf` on an idle machine: that run rewrites the current environment's entries
 * for the measurements it takes, instead of comparing against them, once the test has finished.
 *
 * Recording is refused, loudly, when the machine is not idle (one-minute load average above MAX_LOAD_TO_RECORD) or
 * when anything in the test failed, a budget included: a baseline taken from a run that was already
 * outside its budgets would make the slide the new normal. (A known defect is therefore never in the same test as a baseline:
 * the layout-shift ratchets are tests of their own, apart from the PERF-01 pins.)
 *
 * The `ci` set is recorded by the manual "record-perf-baseline" run of the CI workflow (workflow_dispatch with the
 * `record_perf_baseline` input): its job runs this same command on a runner and uploads tests/performance/baseline.json as the
 * `perf-baseline-ci` artifact. Nothing here may push, so committing that file is a human step; until it is committed, CI
 * runs on budgets and fixed ceilings alone and says so (see missingBaseline).
 */
const BASELINE_FILE = join(__dirname, '../tests/performance/baseline.json');
type Recorded = Record<keyof Vitals, { median: number; spread: number }>;
type Baseline = Record<string, Record<string, Partial<Recorded>>>;

/** Whether this is a CI run: CI set to anything but empty, `0` or `false` (a shell that exports `CI=false` is a laptop). */
export const onCI = (value: string | undefined = process.env.CI): boolean => !['', '0', 'false'].includes((value ?? '').trim().toLowerCase());

/**
 * The machine the medians belong to: a baseline recorded on a laptop means nothing on the CI runner, so the file holds
 * one set per environment. `ci` when CI is set (runners differ between runs, which the margin and the floors absorb);
 * otherwise `local-<hash>`, keyed by a hash of the CPU model and core count so a second machine, or a new laptop, has no
 * baseline until it records its own rather than being held to another machine's numbers. The model is hashed, not written: this
 * file is committed to a public repository, and the owner's hardware is nobody's business. Only an entry for the current environment is enforced.
 */
export const baselineEnvironment = (): string => {
  if (onCI()) return 'ci';
  const hash = createHash('sha256').update(`${cpus()[0]?.model.trim() ?? 'unknown CPU'}|${cpus().length}`).digest('hex');
  return `local-${hash.slice(0, 10)}`;
};

/** Recording rewrites one shared file, so it needs the perf project's single worker. Checked wherever the file is about to be written, not only where a recording starts. */
function assertSingleWorker(testInfo: TestInfo): void {
  if (testInfo.parallelIndex !== 0) {
    throw new Error(`Refusing to record the performance baseline from worker ${testInfo.parallelIndex}: recording rewrites one shared file and needs the perf project's single worker (run with --workers=1).`);
  }
}

/**
 * Called when a spec asks for the limits while UPDATE_PERF_BASELINE=1: refuses at once, before anything is judged, so a busy
 * machine, or a second worker, cannot produce a baseline by accident. `loadAtRunStart` is the one-minute load average as
 * the worker began (see the `runStartLoad` fixture).
 */
export function assertCanRecord(testInfo: TestInfo, loadAtRunStart: number): void {
  assertSingleWorker(testInfo);
  // Windows reports a load average of 0 always: that is "unknown", not "idle".
  if (loadavg().every((value) => value === 0)) {
    throw new Error('Refusing to record the performance baseline: this platform reports no load average, so an idle machine cannot be told from a busy one.');
  }
  if (loadAtRunStart > MAX_LOAD_TO_RECORD) {
    throw new Error(`Refusing to record the performance baseline: the one-minute load average was ${loadAtRunStart.toFixed(2)} when the run began (limit ${MAX_LOAD_TO_RECORD}). Record on an idle machine.`);
  }
}

/** The load-average sentence of a measurement's annotation, which reads against the limit a recording must stay under. */
export const hostLoadNote = (name: string, loadAtRunStart: number): string =>
  `${name}: one-minute load average ${loadavg()[0].toFixed(2)} on ${cpus().length} CPUs, ${loadAtRunStart.toFixed(2)} when the run began (a recording needs the latter under ${MAX_LOAD_TO_RECORD}; the run's own work raises the former)`;

/**
 * A missing baseline is a gap in what the run proves, so it is never silent: a test annotation says which
 * measurement had none, and on GitHub Actions a workflow warning puts the same sentence on the run's summary. The test itself
 * still holds its fixed limits (budgets, ceilings), which is why this does not fail it.
 */
export function missingBaseline(testInfo: TestInfo, { name, median }: Measured): void {
  const env = baselineEnvironment();
  const message = `no performance baseline for "${name}" on ${env}: only the fixed budgets apply, so a slide inside them goes unnoticed. Record it (UPDATE_PERF_BASELINE=1, on CI the record-perf-baseline workflow run) and commit tests/performance/baseline.json. Measured: LCP ${median.lcp} ms, CLS ${median.cls}, TBT ${median.tbt} ms, INP-proxy ${median.inp} ms.`;
  testInfo.annotations.push({ type: 'baseline', description: message });
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Performance baseline missing::${message}`);
  else if (onCI()) console.warn(`warning: ${message}`);
}

/**
 * Writes the recordings of a finished test: only an idle machine's passing test is believed. A read-modify-write of one
 * shared file, so it is safe only because the perf project runs a single worker (playwright.config.ts): two workers recording
 * at once would overwrite each other's entries, which `assertSingleWorker` refuses here as well as where the recording starts.
 */
export function record(testInfo: TestInfo, recordings: Recording[], loadAtRunStart: number): void {
  assertSingleWorker(testInfo);
  for (const { measurement, metrics } of recordings) {
    if (testInfo.errors.length) {
      testInfo.annotations.push({ type: 'baseline', description: `NOT recorded for "${measurement.name}": the test failed (${testInfo.errors.length} error(s)), and a baseline is only taken from a run inside its budgets` });
      continue;
    }
    if (loadAtRunStart > MAX_LOAD_TO_RECORD) {
      testInfo.annotations.push({ type: 'baseline', description: `NOT recorded for "${measurement.name}": the load average was ${loadAtRunStart.toFixed(2)} when the run began` });
      continue;
    }
    const recorded: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    const env = baselineEnvironment();
    // A noisy metric is left out of the file, not written for something else to ignore: only the spec's fixed limits hold it.
    const noisy = metrics.filter((metric) => isNoisy(metric, measurement.spread[metric]));
    const entry = Object.fromEntries(metrics.filter((metric) => !noisy.includes(metric)).map((metric) => [metric, { median: measurement.median[metric], spread: measurement.spread[metric] }]));
    if (noisy.length) {
      testInfo.annotations.push({ type: 'baseline', description: `NOISY for "${measurement.name}": ${noisy.join(', ')} (${MARGIN_SPREADS} x spread is over the cap), not recorded, so only the fixed limits hold it; record again on an idle machine` });
    }
    recorded[env] = { ...recorded[env], [measurement.name]: entry };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(recorded, null, 2)}\n`);
  }
}

/** The recorded median of each metric plus its margin, or undefined when this environment has no entry for the measurement. */
export function baselineLimits({ name }: Measured, metrics: (keyof Vitals)[], testInfo: TestInfo): Partial<Vitals> | undefined {
  const env = baselineEnvironment();
  const recorded: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const { limits, unratcheted } = ratchetLimits(recorded[env]?.[name], metrics);
  if (unratcheted.length) testInfo.annotations.push({ type: 'baseline', description: `the ${env} baseline of "${name}" does not ratchet ${unratcheted.join(', ')} (too noisy, or not recorded because it was): only the fixed limits hold them until it is recorded again on an idle machine` });
  return limits;
}

/**
 * The limits a recorded entry sets: median plus margin, the margin being the larger of MARGIN_SPREADS x spread, MARGIN_SHARE of the
 * median and the noise floor, capped at MARGIN_CAP_FLOORS floors. A metric whose recorded spread is too noisy, or that the entry
 * does not hold (a recording leaves a noisy one out), has no limit and is listed in `unratcheted`. No entry at all: no limits.
 * Exported for tests/framework/performance-maths.spec.ts.
 */
export function ratchetLimits(base: Partial<Recorded> | undefined, metrics: (keyof Vitals)[]): { limits: Partial<Vitals> | undefined; unratcheted: (keyof Vitals)[] } {
  if (!base) return { limits: undefined, unratcheted: [] };
  const limits: Partial<Vitals> = {};
  const unratcheted: (keyof Vitals)[] = [];
  for (const metric of metrics) {
    const value = base[metric];
    if (!value || isNoisy(metric, value.spread)) {
      unratcheted.push(metric);
      continue;
    }
    const margin = Math.min(Math.max(MARGIN_SPREADS * value.spread, MARGIN_SHARE * value.median, NOISE_FLOOR[metric]), MARGIN_CAP_FLOORS * NOISE_FLOOR[metric]);
    const limit = value.median + margin;
    limits[metric] = metric === 'cls' ? Number(limit.toFixed(3)) : Math.round(limit);
  }
  return { limits, unratcheted };
}

/** The recorded spread is too wide for a margin that stays meaningful: the cap would clip it, so the metric has no ratchet (see MARGIN_CAP_FLOORS). */
export function isNoisy(metric: keyof Vitals, spread: number): boolean {
  return MARGIN_SPREADS * spread > MARGIN_CAP_FLOORS * NOISE_FLOOR[metric];
}
