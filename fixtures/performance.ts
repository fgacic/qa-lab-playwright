import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';

/**
 * Web-vitals-style measurements from the browser's own PerformanceObserver entries:
 * - LCP: the last largest-contentful-paint entry before the first interaction;
 * - CLS: the sum of layout shifts not caused by recent input (one session, for simplicity);
 * - TBT: the sum of long-task time above 50 ms in tasks that start at or after First Contentful Paint and before the
 *   first interaction, a lab proxy for responsiveness during load (Lighthouse's window starts at FCP too; what the
 *   interaction itself costs is the INP proxy's business, and a task that began before FCP is the page's blank start, not blocking);
 * - INP proxy: the longest duration (input to next paint) of the interactions a test makes.
 * The entry types used are Chromium's (WebKit has no LCP, layout-shift or longtask entries).
 *
 * The browser runs throttled (see THROTTLING), the way Lighthouse's mobile preset does, because
 * against a container on localhost nothing is slow enough to measure: LCP is a few hundred
 * milliseconds and TBT is zero for any code. `vitals.measure` repeats a scenario in fresh page
 * loads (5 by default: an odd count of five gives a median that one outlier load cannot move, and
 * five cold loads of the slowest scenario still fit a test's time budget) and reports the median, since one load is mostly
 * noise from whatever else the CPU is doing. It also reports the spread (largest minus smallest sample), which sizes the baseline's margin.
 *
 * Limits come in two kinds. The specs hold every median to Google's "good" limits, which only
 * catch a gross regression; `vitals.baseline` adds a limit relative to what this shop measured
 * when the baseline was recorded (tests/performance/baseline.json, see baselineLimits), which
 * catches a slide that stays inside the good range. A spec must hold a fixed limit that holds
 * everywhere (a budget or a ceiling) next to it: a baseline may be missing on an environment, and a test
 * must never pass by skipping its only promise.
 */
export interface Vitals {
  lcp: number;
  cls: number;
  tbt: number;
  inp: number;
}

/** How much evidence stands behind a measurement: a 0 for "nothing observed" must not read as "fast". */
export interface Observed {
  /** Whether First Contentful Paint was reported, which opens the TBT window: without it a TBT of 0 means "no window", not "no blocking". */
  fcpObserved: boolean;
  /** largest-contentful-paint entries seen. */
  lcpEntries: number;
  /** Discrete interactions (clicks, key presses) the browser reported to the event-timing API: only those that took 16 ms or more, plus the first input. */
  interactions: number;
  /** Trusted clicks and key presses the page received, whatever they cost: what the scenario actually did, to hold against what it declared. */
  inputs: number;
  /** Whether the browser can report long tasks at all: without it a TBT of 0 means "not observed", not "no blocking". */
  longTaskObserver: boolean;
}

export interface Measurement {
  /** What the measurement was called: the key of its entry in the baseline. */
  name: string;
  /** The median of every metric across the samples. */
  median: Vitals;
  samples: Vitals[];
  /** Largest minus smallest sample of every metric: how much two loads of the same code differed here. */
  spread: Vitals;
  /** The smallest count over the samples: every sample must have observed it. */
  observed: Observed;
  /** How many clicks and key presses the scenario declared it makes (see `measure`): `observed.inputs` is held to it. */
  expectedInputs: number;
  /** The element each sample's last LCP candidate was, as a short selector: which element "main content" was, for anyone reading a slide. */
  lcpElements: string[];
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
 * The one-minute load average as the run began, before its first measurement. What a recording must not compete with is
 * the rest of the machine, not the throttled loads the run itself makes: those raise the average past the limit a few
 * measurements in, and judging by the later reading would refuse every run for its own load. One worker runs the perf
 * project, so the first `measure` of the process is the first work of the run.
 */
let loadAtRunStart: number | undefined;

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

/**
 * The machine the medians belong to: a baseline recorded on a laptop means nothing on the CI runner, so the file holds
 * one set per environment. `ci` when CI is set (runners differ between runs, which the margin and the floors absorb);
 * otherwise `local-<hash>`, keyed by a hash of the CPU model and core count so a second machine, or a new laptop, has no
 * baseline until it records its own rather than being held to another machine's numbers. The model is hashed, not written: this
 * file is committed to a public repository, and the owner's hardware is nobody's business. Only an entry for the current environment is enforced.
 */
export const baselineEnvironment = (): string => {
  if (process.env.CI) return 'ci';
  const hash = createHash('sha256').update(`${cpus()[0]?.model.trim() ?? 'unknown CPU'}|${cpus().length}`).digest('hex');
  return `local-${hash.slice(0, 10)}`;
};

/**
 * What the measured browser is slowed to. CPU: 4x, Lighthouse's mobile setting (a mid-range
 * phone). Network: 40 ms round trip, 10 Mbps down, 5 Mbps up, roughly a good 4G connection.
 * The budgets in the spec are Google's "good" limits, so they read as: on a mid-range phone on a
 * good connection, the shop is good. They do not describe the container's own speed.
 */
export const THROTTLING = { cpuSlowdown: 4, latencyMs: 40, downloadBytesPerSecond: (10 * 1024 * 1024) / 8, uploadBytesPerSecond: (5 * 1024 * 1024) / 8 } as const;

export interface PerformanceFixtures {
  /** Install the collector and the throttling. An option, so both are in place before any page fixture navigates. */
  measureVitals: boolean;
  vitalsCollector: void;
  vitals: {
    /**
     * Runs `scenario` (the visit being budgeted) once per sample, each time on a fresh navigation to the address the fixtures
     * opened (the first sample too, so no sample is a page the others are not), and returns the median. Every run annotates the
     * host's one-minute load average, so a number can be read against how busy the machine was.
     *
     * `inputs` is how many clicks and key presses the scenario makes (0 for a page that is only loaded); the collector counts
     * the trusted ones the page really received and `Measurement.observed.inputs` is held to it, so a scenario that stops
     * interacting (a click that no longer lands) cannot go on passing on the load alone. A scenario that interacts must do so only
     * once the page's main content is visible: the blocking time of the load is counted up to the first input, and an input that
     * lands earlier on one page than on another would make their TBT windows different.
     * `freshCart` empties the browser's cart between samples (the SPA keeps it in sessionStorage), for a scenario that adds to it:
     * otherwise every sample after the first adds to a cart the earlier ones filled.
     */
    measure: (name: string, scenario: () => Promise<void>, options: { inputs: number; samples?: number; freshCart?: boolean }) => Promise<Measurement>;
    /**
     * The limits `metrics` of a measurement may reach: the baseline recorded for its name in this environment
     * plus its margin (see MARGIN_SPREADS). With UPDATE_PERF_BASELINE=1 it returns no limits and records the
     * measurement as the new baseline once the test has passed (see BASELINE_FILE).
     * Undefined when this environment has no baseline for it: that is annotated (on CI also as a workflow warning),
     * so the spec's fixed limits are all that apply and the run says so.
     */
    baseline: (measurement: Measurement, metrics: (keyof Vitals)[]) => Partial<Vitals> | undefined;
    /**
     * Blocks the page's main thread for `ms`, from a timer, as a task of the page's own event loop: a script evaluated over the
     * debugging protocol is not reported as a long task, so blocking inside `evaluate` itself would leave the observer with nothing to count.
     * For the collector's control.
     */
    blockMainThread: (ms: number) => Promise<void>;
  };
}

interface PageVitals {
  values: Vitals;
  entries: Observed;
  flush: () => void;
  /** A short selector for the element the last LCP candidate was. */
  lcpElement: () => string;
}

/** The keys the SPA keeps its cart under, in sessionStorage (the same two fixtures/api.ts seeds). */
const CART_STORAGE_KEYS = ['cart_id', 'cart_quantity'];

export const test = base.extend<PerformanceFixtures>({
  measureVitals: [false, { option: true }],
  vitalsCollector: [
    async ({ page, measureVitals }, use) => {
      if (measureVitals) {
        await throttle(page);
        await page.addInitScript(collect);
      }
      await use();
    },
    { auto: true },
  ],
  vitals: async ({ page, measureVitals }, use, testInfo) => {
    const recordings: { measurement: Measurement; metrics: (keyof Vitals)[] }[] = [];
    await use({
      measure: async (name, scenario, { inputs, samples = 5, freshCart = false }) => {
        if (!measureVitals) throw new Error('vitals.measure needs test.use({ measureVitals: true }): the collector and the throttling were never installed.');
        const start = page.url();
        loadAtRunStart ??= loadavg()[0];
        const taken: { vitals: Vitals; entries: Observed; lcpElement: string }[] = [];
        for (let i = 0; i < samples; i++) {
          if (freshCart && i > 0) await page.evaluate((keys) => keys.forEach((key) => sessionStorage.removeItem(key)), CART_STORAGE_KEYS);
          // Every sample is a fresh load of the page the fixtures opened, acted on from the same point (the load event),
          // so none of them is an idle page the others are not.
          await page.goto(start, { waitUntil: 'load' });
          await scenario();
          taken.push(await read(page, name, inputs > 0));
        }
        const load = loadavg()[0];
        testInfo.annotations.push({ type: 'host-load', description: `${name}: one-minute load average ${load.toFixed(2)} on ${cpus().length} CPUs, ${loadAtRunStart.toFixed(2)} when the run began (a recording needs the latter under ${MAX_LOAD_TO_RECORD}; the run's own work raises the former)` });
        const all = taken.map((t) => t.vitals);
        const column = (metric: keyof Vitals) => all.map((v) => v[metric]);
        const median: Vitals = {
          lcp: Math.round(middle(column('lcp'))),
          cls: Number(middle(column('cls')).toFixed(3)),
          tbt: Math.round(middle(column('tbt'))),
          inp: Math.round(middle(column('inp'))),
        };
        const range = (metric: keyof Vitals) => Math.max(...column(metric)) - Math.min(...column(metric));
        const spread: Vitals = { lcp: Math.round(range('lcp')), cls: Number(range('cls').toFixed(3)), tbt: Math.round(range('tbt')), inp: Math.round(range('inp')) };
        const observed: Observed = {
          fcpObserved: taken.every((t) => t.entries.fcpObserved),
          lcpEntries: Math.min(...taken.map((t) => t.entries.lcpEntries)),
          interactions: Math.min(...taken.map((t) => t.entries.interactions)),
          // The most any sample saw, not the fewest: a sample that got an extra input is as wrong as one that got too few.
          inputs: Math.max(...taken.map((t) => t.entries.inputs)),
          longTaskObserver: taken.every((t) => t.entries.longTaskObserver),
        };
        const lcpElements = taken.map((t) => t.lcpElement);
        const body = JSON.stringify({ median, spread, samples: all, entries: taken.map((t) => t.entries), lcpElements, observed, expectedInputs: inputs, throttling: THROTTLING }, null, 2);
        await testInfo.attach(`vitals-${name}.json`, { body, contentType: 'application/json' });
        testInfo.annotations.push({ type: 'vitals', description: `${name} (median of ${samples}): LCP ${median.lcp} ms, CLS ${median.cls}, TBT ${median.tbt} ms, INP-proxy ${median.inp} ms; LCP element ${[...new Set(lcpElements)].join(' | ')}` });
        return { name, median, spread, samples: all, observed, expectedInputs: inputs, lcpElements };
      },
      blockMainThread: (ms) =>
        page.evaluate(
          (duration) =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                const end = performance.now() + duration;
                while (performance.now() < end);
                resolve();
              }, 0),
            ),
          ms,
        ),
      baseline: (measurement, metrics) => {
        if (process.env.UPDATE_PERF_BASELINE === '1') {
          // Refused at once, before anything is judged, so a busy machine, or a second worker, cannot produce a baseline by accident.
          if (testInfo.parallelIndex !== 0) {
            throw new Error(`Refusing to record the performance baseline from worker ${testInfo.parallelIndex}: recording rewrites one shared file and needs the perf project's single worker (run with --workers=1).`);
          }
          const load = loadAtRunStart ?? loadavg()[0];
          if (load > MAX_LOAD_TO_RECORD) {
            throw new Error(`Refusing to record the performance baseline: the one-minute load average was ${load.toFixed(2)} when the run began (limit ${MAX_LOAD_TO_RECORD}). Record on an idle machine.`);
          }
          recordings.push({ measurement, metrics });
          testInfo.annotations.push({ type: 'baseline', description: `recording ${measurement.name} for ${baselineEnvironment()} once the test has passed` });
          return undefined;
        }
        const limits = baselineLimits(measurement, metrics, testInfo);
        if (!limits) missingBaseline(testInfo, measurement);
        return limits;
      },
    });
    if (recordings.length) record(testInfo, recordings);
  },
});

/**
 * A missing baseline is a gap in what the run proves, so it is never silent: a test annotation says which
 * measurement had none, and on GitHub Actions a workflow warning puts the same sentence on the run's summary. The test itself
 * still holds its fixed limits (budgets, ceilings), which is why this does not fail it.
 */
function missingBaseline(testInfo: TestInfo, { name, median }: Measurement): void {
  const env = baselineEnvironment();
  const message = `no performance baseline for "${name}" on ${env}: only the fixed budgets apply, so a slide inside them goes unnoticed. Record it (UPDATE_PERF_BASELINE=1, on CI the record-perf-baseline workflow run) and commit tests/performance/baseline.json. Measured: LCP ${median.lcp} ms, CLS ${median.cls}, TBT ${median.tbt} ms, INP-proxy ${median.inp} ms.`;
  testInfo.annotations.push({ type: 'baseline', description: message });
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Performance baseline missing::${message}`);
  else if (process.env.CI) console.warn(`warning: ${message}`);
}

/**
 * Writes the recordings of a finished test: only an idle machine's passing test is believed. A read-modify-write of one
 * shared file, so it is safe only because the perf project runs a single worker (playwright.config.ts): two workers recording
 * at once would overwrite each other's entries.
 */
function record(testInfo: TestInfo, recordings: { measurement: Measurement; metrics: (keyof Vitals)[] }[]): void {
  for (const { measurement, metrics } of recordings) {
    if (testInfo.errors.length) {
      testInfo.annotations.push({ type: 'baseline', description: `NOT recorded for "${measurement.name}": the test failed (${testInfo.errors.length} error(s)), and a baseline is only taken from a run inside its budgets` });
      continue;
    }
    const load = loadAtRunStart ?? loadavg()[0];
    if (load > MAX_LOAD_TO_RECORD) {
      testInfo.annotations.push({ type: 'baseline', description: `NOT recorded for "${measurement.name}": the load average was ${load.toFixed(2)} when the run began` });
      continue;
    }
    const recorded: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    const env = baselineEnvironment();
    const entry = Object.fromEntries(metrics.map((metric) => [metric, { median: measurement.median[metric], spread: measurement.spread[metric] }]));
    const noisy = metrics.filter((metric) => isNoisy(metric, measurement.spread[metric]));
    if (noisy.length) {
      testInfo.annotations.push({ type: 'baseline', description: `NOISY for "${measurement.name}": ${noisy.join(', ')} (${MARGIN_SPREADS} x spread is over the cap), recorded but not enforced as a ratchet; record again on an idle machine` });
    }
    recorded[env] = { ...recorded[env], [measurement.name]: entry };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(recorded, null, 2)}\n`);
  }
}

/** Slows this page's CPU and network through the DevTools protocol (Chromium only). */
async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLING.cpuSlowdown });
  await cdp.send('Network.enable');
  // Every load is cold, like a first visit: a reload served from cache has no scripts to compile, so TBT would read 0.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: THROTTLING.latencyMs,
    downloadThroughput: THROTTLING.downloadBytesPerSecond,
    uploadThroughput: THROTTLING.uploadBytesPerSecond,
  });
}

/** Asks the page's observers for what they hold but have not delivered yet, then reads the totals. */
async function read(page: Page, name: string, interactive: boolean): Promise<{ vitals: Vitals; entries: Observed; lcpElement: string }> {
  const flush = () =>
    page.evaluate(() => {
      const vitals = (window as unknown as { __qaLabVitals?: PageVitals }).__qaLabVitals;
      if (!vitals) return undefined;
      vitals.flush();
      return { values: { ...vitals.values }, entries: { ...vitals.entries }, lcpElement: vitals.lcpElement() };
    });
  // Entries arrive a little after what causes them: an LCP candidate once it is painted, an interaction once the frame
  // after the input has been presented. Wait for the evidence this scenario is owed. If it never comes the sample goes on
  // with what there is, and the spec's assertion on the evidence says so.
  let collected: Awaited<ReturnType<typeof flush>> | undefined;
  const owed = () => !!collected && collected.entries.lcpEntries > 0 && (!interactive || collected.entries.interactions > 0);
  await expect.poll(async () => ((collected = await flush()), owed()), { timeout: 5_000 }).toBe(true).catch(() => undefined);
  if (!collected) throw new Error(`No vitals were collected for "${name}": the collector did not run in this document (was the page opened before measureVitals took effect?).`);
  return { vitals: collected.values, entries: collected.entries, lcpElement: collected.lcpElement };
}

/** The recorded median of each metric plus its margin, or undefined when this environment has no entry for the measurement. */
function baselineLimits({ name }: Measurement, metrics: (keyof Vitals)[], testInfo: TestInfo): Partial<Vitals> | undefined {
  const env = baselineEnvironment();
  const recorded: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const base = recorded[env]?.[name];
  if (!base) return undefined;
  const limits = metrics.map((metric) => {
    const value = base[metric];
    if (value === undefined) throw new Error(`The ${env} baseline of "${name}" has no ${metric}: record it with UPDATE_PERF_BASELINE=1 npm run test:perf.`);
    const margin = Math.min(Math.max(MARGIN_SPREADS * value.spread, MARGIN_SHARE * value.median, NOISE_FLOOR[metric]), MARGIN_CAP_FLOORS * NOISE_FLOOR[metric]);
    const limit = value.median + margin;
    return [metric, metric === 'cls' ? Number(limit.toFixed(3)) : Math.round(limit)] as const;
  });
  const trusted = Object.fromEntries(limits.filter(([metric]) => !isNoisy(metric, base[metric]!.spread)));
  const noisy = limits.map(([metric]) => metric).filter((metric) => !(metric in trusted));
  if (noisy.length) testInfo.annotations.push({ type: 'baseline', description: `the ${env} baseline of "${name}" is too noisy to ratchet ${noisy.join(', ')}: only the fixed limits hold them until it is recorded again on an idle machine` });
  return trusted;
}

/** The recorded spread is too wide for a margin that stays meaningful: the cap would clip it, so the metric has no ratchet (see MARGIN_CAP_FLOORS). */
function isNoisy(metric: keyof Vitals, spread: number): boolean {
  return MARGIN_SPREADS * spread > MARGIN_CAP_FLOORS * NOISE_FLOOR[metric];
}

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Runs in the page before any of its scripts. */
function collect() {
  const values = { lcp: 0, cls: 0, tbt: 0, inp: 0 };
  const entries = { fcpObserved: false, lcpEntries: 0, interactions: 0, inputs: 0, longTaskObserver: !!PerformanceObserver.supportedEntryTypes?.includes('longtask') };
  // An interaction is several events (pointerdown, pointerup and click share one interactionId), so they are counted by id.
  const seen = { interactionIds: new Set<number>(), firstInputs: 0 };
  // Blocking time counts only tasks between First Contentful Paint and the first input, so it is the cost of loading, not of the interaction.
  const longTasks: { start: number; duration: number }[] = [];
  let firstInputAt = Infinity;
  let fcp = Infinity; // until it is reported no task is inside the TBT window, and `fcpObserved` says so
  const observers: { observer: PerformanceObserver; handle: (e: Entry) => void }[] = [];
  type Entry = PerformanceEntry & { value: number; hadRecentInput: boolean; interactionId?: number; element?: Element | null };
  let lcpElement: Element | null | undefined;
  const observe = (type: string, handle: (e: Entry) => void, extra: object = {}) => {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => handle(e as Entry)));
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    observers.push({ observer, handle });
  };
  observe('largest-contentful-paint', (e) => {
    values.lcp = e.startTime;
    lcpElement = e.element;
    entries.lcpEntries++;
  });
  observe('paint', (e) => {
    if (e.name !== 'first-contentful-paint') return;
    fcp = e.startTime;
    entries.fcpObserved = true;
  });
  observe('layout-shift', (e) => {
    if (!e.hadRecentInput) values.cls += e.value;
  });
  observe('longtask', (e) => longTasks.push({ start: e.startTime, duration: e.duration }));
  // Discrete interactions only (a click has an interactionId, a mouse-over does not). Event timing
  // reports nothing under 16 ms, so the first-input entry, which has no such floor, also counts.
  observe(
    'event',
    (e) => {
      if (!e.interactionId) return;
      seen.interactionIds.add(e.interactionId);
      values.inp = Math.max(values.inp, e.duration);
    },
    { durationThreshold: 16 },
  );
  observe('first-input', (e) => {
    seen.firstInputs++;
    firstInputAt = Math.min(firstInputAt, e.startTime);
    values.inp = Math.max(values.inp, e.duration);
  });
  // What the scenario really did to the page, whatever it cost: trusted clicks and key presses (event timing hides the quick ones).
  for (const type of ['click', 'keydown']) window.addEventListener(type, (event) => void (event.isTrusted && entries.inputs++), true);
  // A selector a reader can find the element by: its test id, id, alt text or tag and first classes. Not unique, and not meant to be.
  const selectorOf = (element: Element | null | undefined): string => {
    if (!element) return 'none';
    const testId = element.getAttribute('data-test');
    const alt = element.getAttribute('alt');
    const id = element.id;
    const classes = [...element.classList].slice(0, 2).join('.');
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const hint = testId ? `[data-test="${testId}"]` : id ? `#${id}` : alt ? `[alt="${alt}"]` : classes ? `.${classes}` : text ? ` "${text}"` : '';
    return `${element.tagName.toLowerCase()}${hint}`.slice(0, 120);
  };
  (window as unknown as { __qaLabVitals: PageVitals }).__qaLabVitals = {
    values,
    entries,
    lcpElement: () => selectorOf(lcpElement),
    // takeRecords() hands over what an observer has queued but not yet delivered, so nothing is waited for.
    flush: () => {
      observers.forEach(({ observer, handle }) => observer.takeRecords().forEach((e) => handle(e as Entry)));
      entries.interactions = Math.max(seen.interactionIds.size, seen.firstInputs);
      values.tbt = longTasks.filter((task) => task.start >= fcp && task.start < firstInputAt).reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
    },
  };
}
