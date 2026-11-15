import { expect, test as base, type Page } from '@playwright/test';

/**
 * Web-vitals-style measurements from the browser's own PerformanceObserver entries:
 * - LCP: the last largest-contentful-paint entry before the first interaction;
 * - CLS: the sum of layout shifts not caused by recent input (one session, for simplicity);
 * - TBT: the sum of long-task time above 50 ms, a lab proxy for responsiveness during load;
 * - INP proxy: the longest duration (input to next paint) of the interactions a test makes.
 * The entry types used are Chromium's (WebKit has no LCP, layout-shift or longtask entries).
 *
 * The browser runs throttled (see THROTTLING), the way Lighthouse's mobile preset does, because
 * against a container on localhost nothing is slow enough to measure: LCP is a few hundred
 * milliseconds and TBT is zero for any code. `vitals.measure` repeats a scenario in fresh page
 * loads and reports the median, since one load is mostly noise from whatever else the CPU is doing.
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
  /** The median of every metric across the samples. */
  median: Vitals;
  samples: Vitals[];
  /** The smallest count over the samples: every sample must have observed it. */
  observed: Observed;
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
  vitals: {
    /**
     * Runs `scenario` (the visit being budgeted) on the page as it is now, then again after
     * reloading its address for every further sample, and returns the median.
     */
    measure: (name: string, scenario: () => Promise<void>, options?: { samples?: number; interactive?: boolean }) => Promise<Measurement>;
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
          // The first sample is the page the fixtures already opened; each later one is a fresh load of it.
          if (i > 0) await page.goto(start, { waitUntil: 'domcontentloaded' });
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
        return { median, samples: all, observed };
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
  // Event timing entries are created once the frame after the input has been presented, so let one go by first.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))));
  let collected = await flush();
  // A scenario that interacts has evidence to wait for: the browser reports the input a little after the paint.
  // If it never does, the sample goes on with zero interactions and the spec's assertion says so.
  if (collected && interactive) await expect.poll(async () => (collected = await flush())?.entries.interactions ?? 0, { timeout: 5_000 }).toBeGreaterThan(0).catch(() => undefined);
  if (!collected) throw new Error(`No vitals were collected for "${name}": the collector did not run in this document (was the page opened before measureVitals took effect?).`);
  return { vitals: collected.values, entries: collected.entries };
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
  observe('longtask', (e) => (values.tbt += Math.max(0, e.duration - 50)));
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
    values.inp = Math.max(values.inp, e.duration);
  });
  (window as unknown as { __qaLabVitals: PageVitals }).__qaLabVitals = {
    values,
    entries,
    // takeRecords() hands over what an observer has queued but not yet delivered, so nothing is waited for.
    flush: () => {
      observers.forEach(({ observer, handle }) => observer.takeRecords().forEach((e) => handle(e as Entry)));
      entries.interactions = Math.max(seen.events, seen.firstInputs);
    },
  };
}
