import { expect, type Page, type TestInfo } from '@playwright/test';
import type { Vitals } from './performance-baseline';

// The browser side of the web-vitals measurement (see the overview in performance.ts): the throttling, the in-page collector
// and the read of what it gathered. The fixtures and the statistics stay in performance.ts.

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

/**
 * What the measured browser is slowed to. CPU: 4x, Lighthouse's mobile setting (a mid-range
 * phone). Network: 40 ms round trip, 10 Mbps down, 5 Mbps up, roughly a good 4G connection.
 * The budgets in the spec are Google's "good" limits, so they read as: on a mid-range phone on a
 * good connection, the shop is good. They do not describe the container's own speed.
 */
export const THROTTLING = { cpuSlowdown: 4, latencyMs: 40, downloadBytesPerSecond: (10 * 1024 * 1024) / 8, uploadBytesPerSecond: (5 * 1024 * 1024) / 8 } as const;

interface PageVitals {
  values: Vitals;
  entries: Observed;
  flush: () => void;
  /** A short selector for the element the last LCP candidate was. */
  lcpElement: () => string;
}

/** Slows this page's CPU and network through the DevTools protocol (Chromium only). */
export async function throttle(page: Page): Promise<void> {
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
export async function read(page: Page, name: string, interactive: boolean, testInfo: TestInfo): Promise<{ vitals: Vitals; entries: Observed; lcpElement: string }> {
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

/** Runs in the page before any of its scripts. */
export function collect() {
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
