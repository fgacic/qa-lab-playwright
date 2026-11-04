import { test as base } from '@playwright/test';

/**
 * Web-vitals-style measurements from the browser's own PerformanceObserver entries:
 * - LCP: the last largest-contentful-paint entry before the first interaction;
 * - CLS: the sum of layout shifts not caused by recent input (one session, for simplicity);
 * - TBT: the sum of long-task time above 50 ms, a lab proxy for responsiveness during load;
 * - INP proxy: the longest event duration (input to next paint) of the interactions a test makes.
 * The entry types used are Chromium's (WebKit has no LCP, layout-shift or longtask entries).
 */
export interface Vitals {
  lcp: number;
  cls: number;
  tbt: number;
  inp: number;
}

export interface PerformanceFixtures {
  /** Install the collector. An option, so it is in place before any page fixture navigates. */
  measureVitals: boolean;
  vitalsCollector: void;
  vitals: { read: (name: string) => Promise<Vitals> };
}

export const test = base.extend<PerformanceFixtures>({
  measureVitals: [false, { option: true }],
  vitalsCollector: [
    async ({ page, measureVitals }, use) => {
      if (measureVitals) await page.addInitScript(collect);
      await use();
    },
    { auto: true },
  ],
  vitals: async ({ page }, use, testInfo) => {
    await use({
      read: async (name) => {
        // Let late paints and shifts land before reading.
        await page.waitForTimeout(1_000);
        const vitals = await page.evaluate(() => (window as unknown as { __qaLabVitals: Vitals }).__qaLabVitals);
        const rounded = { lcp: Math.round(vitals.lcp), cls: Number(vitals.cls.toFixed(3)), tbt: Math.round(vitals.tbt), inp: Math.round(vitals.inp) };
        await testInfo.attach(`vitals-${name}.json`, { body: JSON.stringify(rounded, null, 2), contentType: 'application/json' });
        testInfo.annotations.push({ type: 'vitals', description: `${name}: LCP ${rounded.lcp} ms, CLS ${rounded.cls}, TBT ${rounded.tbt} ms, INP-proxy ${rounded.inp} ms` });
        return rounded;
      },
    });
  },
});

/** Runs in the page before any of its scripts. */
function collect() {
  const v = { lcp: 0, cls: 0, tbt: 0, inp: 0 };
  (window as unknown as { __qaLabVitals: typeof v }).__qaLabVitals = v;
  const observe = (type: string, cb: (e: PerformanceEntry & Record<string, number & boolean>) => void, extra: object = {}) =>
    new PerformanceObserver((list) => list.getEntries().forEach((e) => cb(e as never))).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  observe('largest-contentful-paint', (e) => (v.lcp = e.startTime));
  observe('layout-shift', (e) => {
    if (!e.hadRecentInput) v.cls += e.value;
  });
  observe('longtask', (e) => (v.tbt += Math.max(0, e.duration - 50)));
  observe('event', (e) => (v.inp = Math.max(v.inp, e.duration)), { durationThreshold: 16 });
}
