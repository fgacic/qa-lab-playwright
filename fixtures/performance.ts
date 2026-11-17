import { loadavg } from 'node:os';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import { assertCanRecord, baselineEnvironment, baselineLimits, hostLoadNote, missingBaseline, record, type Recording, type Vitals } from './performance-baseline';

export { isNoisy, onCI, ratchetLimits, type Vitals } from './performance-baseline';

/*
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
/** How much evidence stands behind a measurement: a 0 for "nothing observed" must not read as "fast". */
export interface Observed {
  /** Whether First Contentful Paint was reported, which opens the TBT window: without it a TBT of 0 means "no window", not "no blocking". */
  fcpObserved: boolean;
  /** largest-contentful-paint entries seen. */
  lcpEntries: number;
  /** Discrete interactions (clicks, key presses) the browser reported to the event-timing API: only those that took 16 ms or more, plus the first input. */
  interactions: number;
  /** Trusted clicks and key presses the page received, whatever they cost: what the scenario actually did, to hold against what it declared. Of one load; the aggregate is `Measurement.inputsPerSample`. */
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
  /** How many clicks and key presses the scenario declared it makes (see `measure`): every entry of `inputsPerSample` is held to it. */
  expectedInputs: number;
  /** The trusted clicks and key presses the page received in each sample, in order: one entry per sample, so a single sample that lost (or gained) an input cannot hide behind the others. */
  inputsPerSample: number[];
  /** The element each sample's last LCP candidate was, as a short selector: which element "main content" was, for anyone reading a slide. */
  lcpElements: string[];
}

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
  /** The measurements to record as the baseline, written once the test and every other fixture's teardown has passed (see `record`). */
  baselineRecordings: Recording[];
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

export interface PerformanceWorkerFixtures {
  /**
   * The one-minute load average as the worker began, before its first measurement. What a recording must not compete with is
   * the rest of the machine, not the throttled loads the run itself makes: those raise the average past the limit a few
   * measurements in, and judging by the later reading would refuse every run for its own load. One worker runs the perf
   * project, so this is the load of the run's start.
   */
  runStartLoad: number;
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

export const test = base.extend<PerformanceFixtures, PerformanceWorkerFixtures>({
  runStartLoad: [async ({}, use) => use(loadavg()[0]), { scope: 'worker', auto: true }],
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
  // An auto fixture with no dependency, so it is set up before the page and the guards and torn down after them: the console guard
  // and the write guard have failed the test by the time it looks at `testInfo.errors`, and only then is a baseline believed.
  baselineRecordings: [
    async ({ runStartLoad }, use, testInfo) => {
      const recordings: Recording[] = [];
      await use(recordings);
      if (recordings.length) record(testInfo, recordings, runStartLoad);
    },
    { auto: true },
  ],
  vitals: async ({ page, measureVitals, baselineRecordings: recordings, runStartLoad }, use, testInfo) => {
    let measured = false;
    await use({
      measure: async (name, scenario, { inputs, samples = 5, freshCart = false }) => {
        if (!measureVitals) throw new Error('vitals.measure needs test.use({ measureVitals: true }): the collector and the throttling were never installed.');
        // One measurement per test: the annotations, the attachment and the baseline entry are all keyed by the test, and a second run would be judged by the first one's load.
        if (measured) throw new Error(`vitals.measure was called twice in one test ("${name}"): measure one scenario per test.`);
        measured = true;
        const start = page.url();
        const taken: { vitals: Vitals; entries: Observed; lcpElement: string }[] = [];
        for (let i = 0; i < samples; i++) {
          if (freshCart && i > 0) await page.evaluate((keys) => keys.forEach((key) => sessionStorage.removeItem(key)), CART_STORAGE_KEYS);
          // Every sample is a fresh load of the page the fixtures opened, acted on from the same point (the load event),
          // so none of them is an idle page the others are not.
          await page.goto(start, { waitUntil: 'load' });
          await scenario();
          taken.push(await read(page, name, inputs > 0, testInfo));
        }
        testInfo.annotations.push({ type: 'host-load', description: hostLoadNote(name, runStartLoad) });
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
          // Of the aggregate, the largest: the per-sample counts are in `inputsPerSample`, where an extra input or a missing one is told apart.
          inputs: Math.max(...taken.map((t) => t.entries.inputs)),
          longTaskObserver: taken.every((t) => t.entries.longTaskObserver),
        };
        const lcpElements = taken.map((t) => t.lcpElement);
        const body = JSON.stringify({ median, spread, samples: all, entries: taken.map((t) => t.entries), lcpElements, observed, expectedInputs: inputs, throttling: THROTTLING }, null, 2);
        await testInfo.attach(`vitals-${name}.json`, { body, contentType: 'application/json' });
        testInfo.annotations.push({ type: 'vitals', description: `${name} (median of ${samples}): LCP ${median.lcp} ms, CLS ${median.cls}, TBT ${median.tbt} ms, INP-proxy ${median.inp} ms; LCP element ${[...new Set(lcpElements)].join(' | ')}` });
        return { name, median, spread, samples: all, observed, expectedInputs: inputs, inputsPerSample: taken.map((t) => t.entries.inputs), lcpElements };
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
          assertCanRecord(testInfo, runStartLoad);
          recordings.push({ measurement, metrics });
          testInfo.annotations.push({ type: 'baseline', description: `recording ${measurement.name} for ${baselineEnvironment()} once the test has passed` });
          return undefined;
        }
        const limits = baselineLimits(measurement, metrics, testInfo);
        if (!limits) missingBaseline(testInfo, measurement);
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
async function read(page: Page, name: string, interactive: boolean, testInfo: TestInfo): Promise<{ vitals: Vitals; entries: Observed; lcpElement: string }> {
  const flush = () =>
    page.evaluate(() => {
      const vitals = (window as unknown as { __qaLabVitals?: PageVitals }).__qaLabVitals;
      if (!vitals) return undefined;
      vitals.flush();
      return { values: { ...vitals.values }, entries: { ...vitals.entries }, lcpElement: vitals.lcpElement() };
    });
  // Entries arrive a little after what causes them: an LCP candidate once it is painted, an interaction once the frame
  // after the input has been presented. Wait for the evidence this scenario is owed. If it never comes the sample goes on
  // with what there is, annotated here, and the spec's assertion on the evidence fails on it.
  let collected: Awaited<ReturnType<typeof flush>> | undefined;
  const owed = () => !!collected && collected.entries.lcpEntries > 0 && (!interactive || collected.entries.interactions > 0);
  await expect.poll(async () => ((collected = await flush()), owed()), { timeout: 5_000 }).toBe(true).catch(() => {
    testInfo.annotations.push({ type: 'evidence', description: `${name}: the evidence a sample is owed (an LCP entry${interactive ? ' and an interaction' : ''}) had not arrived after 5 s; the sample was read as it was` });
  });
  if (!collected) throw new Error(`No vitals were collected for "${name}": the collector did not run in this document (was the page opened before measureVitals took effect?).`);
  return { vitals: collected.values, entries: collected.entries, lcpElement: collected.lcpElement };
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
