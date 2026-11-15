import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';

/**
 * Web-vitals-style measurements from the browser's own PerformanceObserver entries:
 * - LCP: the last largest-contentful-paint entry before the first interaction;
 * - CLS: the sum of layout shifts not caused by recent input (one session, for simplicity);
 * - TBT: the sum of long-task time above 50 ms before the first interaction, a lab proxy for
 *   responsiveness during load (what the interaction itself costs is the INP proxy's business);
 * - INP proxy: the longest duration (input to next paint) of the interactions a test makes.
 * The entry types used are Chromium's (WebKit has no LCP, layout-shift or longtask entries).
 *
 * The browser runs throttled (see THROTTLING), the way Lighthouse's mobile preset does, because
 * against a container on localhost nothing is slow enough to measure: LCP is a few hundred
 * milliseconds and TBT is zero for any code. `vitals.measure` repeats a scenario in fresh page
 * loads and reports the median, since one load is mostly noise from whatever else the CPU is doing.
 *
 * Limits come in two kinds. The specs hold every median to Google's "good" limits, which only
 * catch a gross regression; `vitals.baseline` adds a limit relative to what this shop measured
 * when the baseline was recorded (tests/performance/baseline.json, see BASELINE_MARGIN), which
 * catches a slide that stays inside the good range.
 */
export interface Vitals {
  lcp: number;
  cls: number;
  tbt: number;
  inp: number;
}

/** How much evidence stands behind a measurement: a 0 for "nothing observed" must not read as "fast". */
export interface Observed {
  /** largest-contentful-paint entries seen. */
  lcpEntries: number;
  /** Discrete interactions (clicks, key presses) the browser reported to the event-timing API. */
  interactions: number;
}

export interface Measurement {
  /** What the measurement was called: the key of its entry in the baseline. */
  name: string;
  /** The median of every metric across the samples. */
  median: Vitals;
  samples: Vitals[];
  /** The smallest count over the samples: every sample must have observed it. */
  observed: Observed;
}

/**
 * A baseline-relative limit is the recorded median plus this share, never less than the metric's
 * noise floor above it: 30% of a TBT of 0 is 0, and a single 60 ms task is not a regression.
 * The floors are about what two runs of the same code differ by. Measured over three recordings on an idle machine
 * (load average under 4): LCP varied by at most 24 ms per page, TBT not at all, CLS not at all, and the INP proxy
 * between 16 and 24 ms, a single step of event timing, which rounds to 8 ms so a frame can land either side of an input.
 * The INP floor is 32 ms, four of those steps: wide enough for the run-to-run spread, narrow enough to catch a real slide
 * long before the 200 ms budget. It does not try to absorb a busy machine: a floor widened after a failure under a load
 * average of 11 to 34 (the proxy reached 72 ms) only hides what is wrong with that measurement. Budgets are measured
 * alone on an idle machine, and the baseline is recorded on one.
 */
export const BASELINE_MARGIN = 0.3;
const NOISE_FLOOR: Vitals = { lcp: 100, cls: 0.02, tbt: 50, inp: 32 };


/**
 * Where the medians recorded on the self-hosted shop live, committed with the specs, one set per
 * environment (see baselineEnvironment). Record them anew, after a deliberate change to the shop or
 * to the throttling, with `UPDATE_PERF_BASELINE=1 npm run test:perf` on an idle machine (a load average
 * under 4): that run rewrites the current environment's entries for the measurements it takes instead
 * of comparing against them. The `ci` set is recorded by the manual "record-perf-baseline" run of the
 * CI workflow, which uploads the file as an artifact; committing it is a human step.
 */
const BASELINE_FILE = join(__dirname, '../tests/performance/baseline.json');
type Baseline = Record<string, Record<string, Partial<Vitals>>>;

/**
 * The machine the medians belong to: a baseline recorded on a laptop means nothing on the CI runner, so the file holds
 * one set per environment. `ci` when CI is set, otherwise `local`. Only an entry for the current environment is enforced.
 */
export const baselineEnvironment = (): 'ci' | 'local' => (process.env.CI ? 'ci' : 'local');

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
     * Runs `scenario` (the visit being budgeted) on the page as it is now, then again after
     * reloading its address for every further sample, and returns the median.
     */
    measure: (name: string, scenario: () => Promise<void>, options?: { samples?: number; interactive?: boolean }) => Promise<Measurement>;
    /**
     * The limits `metrics` of a measurement may reach: the baseline recorded for its name in this environment
     * plus BASELINE_MARGIN. With UPDATE_PERF_BASELINE=1 it records the measurement as the new baseline first.
     * Undefined when this environment has no baseline for it: that is annotated, and only the budgets apply.
     */
    baseline: (measurement: Measurement, metrics: (keyof Vitals)[]) => Partial<Vitals> | undefined;
  };
}

interface PageVitals {
  values: Vitals;
  entries: Observed;
  flush: () => void;
}

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
    await use({
      measure: async (name, scenario, { samples = 3, interactive = true } = {}) => {
        if (!measureVitals) throw new Error('vitals.measure needs test.use({ measureVitals: true }): the collector and the throttling were never installed.');
        const start = page.url();
        const taken: { vitals: Vitals; entries: Observed }[] = [];
        for (let i = 0; i < samples; i++) {
          // Every sample is a fresh load of the page the fixtures opened, acted on from the same point (the load event),
          // so none of them is an idle page the others are not.
          await page.goto(start, { waitUntil: 'load' });
          await scenario();
          taken.push(await read(page, name, interactive));
        }
        const all = taken.map((t) => t.vitals);
        const median: Vitals = {
          lcp: Math.round(middle(all.map((v) => v.lcp))),
          cls: Number(middle(all.map((v) => v.cls)).toFixed(3)),
          tbt: Math.round(middle(all.map((v) => v.tbt))),
          inp: Math.round(middle(all.map((v) => v.inp))),
        };
        const observed = { lcpEntries: Math.min(...taken.map((t) => t.entries.lcpEntries)), interactions: Math.min(...taken.map((t) => t.entries.interactions)) };
        const body = JSON.stringify({ median, samples: all, entries: taken.map((t) => t.entries), observed, throttling: THROTTLING }, null, 2);
        await testInfo.attach(`vitals-${name}.json`, { body, contentType: 'application/json' });
        testInfo.annotations.push({ type: 'vitals', description: `${name} (median of ${samples}): LCP ${median.lcp} ms, CLS ${median.cls}, TBT ${median.tbt} ms, INP-proxy ${median.inp} ms` });
        return { name, median, samples: all, observed };
      },
      baseline: (measurement, metrics) => {
        const limits = baselineLimits(measurement, metrics);
        if (!limits) {
          const env = baselineEnvironment();
          const { name, median } = measurement;
          testInfo.annotations.push({
            type: 'baseline',
            description: `no baseline for ${env}: record with UPDATE_PERF_BASELINE=1 (measured ${name}: LCP ${median.lcp} ms, CLS ${median.cls}, TBT ${median.tbt} ms, INP-proxy ${median.inp} ms)`,
          });
        }
        return limits;
      },
    });
  },
});

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
async function read(page: Page, name: string, interactive: boolean): Promise<{ vitals: Vitals; entries: Observed }> {
  const flush = () =>
    page.evaluate(() => {
      const vitals = (window as unknown as { __qaLabVitals?: PageVitals }).__qaLabVitals;
      if (!vitals) return undefined;
      vitals.flush();
      return { values: { ...vitals.values }, entries: { ...vitals.entries } };
    });
  // Entries arrive a little after what causes them: an LCP candidate once it is painted, an interaction once the frame
  // after the input has been presented. Wait for the evidence this scenario is owed. If it never comes the sample goes on
  // with what there is, and the spec's assertion on the evidence says so.
  let collected: Awaited<ReturnType<typeof flush>> | undefined;
  const owed = () => !!collected && collected.entries.lcpEntries > 0 && (!interactive || collected.entries.interactions > 0);
  await expect.poll(async () => ((collected = await flush()), owed()), { timeout: 5_000 }).toBe(true).catch(() => undefined);
  if (!collected) throw new Error(`No vitals were collected for "${name}": the collector did not run in this document (was the page opened before measureVitals took effect?).`);
  return { vitals: collected.values, entries: collected.entries };
}

/** Recorded medians of this measurement's metrics, plus the margin; recorded afresh when UPDATE_PERF_BASELINE=1. */
function baselineLimits({ name, median }: Measurement, metrics: (keyof Vitals)[]): Partial<Vitals> | undefined {
  const env = baselineEnvironment();
  const recorded: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  if (process.env.UPDATE_PERF_BASELINE === '1') {
    recorded[env] = { ...recorded[env], [name]: Object.fromEntries(metrics.map((metric) => [metric, median[metric]])) };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(recorded, null, 2)}\n`);
  }
  const base = recorded[env]?.[name];
  if (!base) return undefined;
  return Object.fromEntries(
    metrics.map((metric) => {
      const value = base[metric];
      if (value === undefined) throw new Error(`The ${env} baseline of "${name}" has no ${metric}: record it with UPDATE_PERF_BASELINE=1 npm run test:perf.`);
      const limit = Math.max(value * (1 + BASELINE_MARGIN), value + NOISE_FLOOR[metric]);
      return [metric, metric === 'cls' ? Number(limit.toFixed(3)) : Math.round(limit)];
    }),
  );
}

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Runs in the page before any of its scripts. */
function collect() {
  const values = { lcp: 0, cls: 0, tbt: 0, inp: 0 };
  const entries = { lcpEntries: 0, interactions: 0 };
  const seen = { events: 0, firstInputs: 0 };
  // Blocking time counts only what happened before the first input, so it is the cost of loading, not of the interaction.
  const longTasks: { start: number; duration: number }[] = [];
  let firstInputAt = Infinity;
  const observers: { observer: PerformanceObserver; handle: (e: Entry) => void }[] = [];
  type Entry = PerformanceEntry & { value: number; hadRecentInput: boolean; interactionId?: number };
  const observe = (type: string, handle: (e: Entry) => void, extra: object = {}) => {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => handle(e as Entry)));
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    observers.push({ observer, handle });
  };
  observe('largest-contentful-paint', (e) => {
    values.lcp = e.startTime;
    entries.lcpEntries++;
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
      seen.events++;
      values.inp = Math.max(values.inp, e.duration);
    },
    { durationThreshold: 16 },
  );
  observe('first-input', (e) => {
    seen.firstInputs++;
    firstInputAt = Math.min(firstInputAt, e.startTime);
    values.inp = Math.max(values.inp, e.duration);
  });
  (window as unknown as { __qaLabVitals: PageVitals }).__qaLabVitals = {
    values,
    entries,
    // takeRecords() hands over what an observer has queued but not yet delivered, so nothing is waited for.
    flush: () => {
      observers.forEach(({ observer, handle }) => observer.takeRecords().forEach((e) => handle(e as Entry)));
      entries.interactions = Math.max(seen.events, seen.firstInputs);
      values.tbt = longTasks.filter((task) => task.start < firstInputAt).reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
    },
  };
}
