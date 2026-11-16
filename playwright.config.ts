import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STORAGE_STATE, BASE_URL, CUSTOMER_STORAGE_STATE, IS_SELF_HOSTED, PROJECTS, RUN_ACCOUNT_TESTS, RUN_ADMIN_TESTS, TARGET } from './src/support/env';

const isCI = !!process.env.CI;
const IN_PLAYWRIGHT_IMAGE = process.env.PLAYWRIGHT_DOCKER === '1';

/**
 * Where a spec may run is decided here, by tag, never by a runtime skip: a test that cannot run
 * in a project is not scheduled there at all, so reports count only real results.
 */
// Playwright greps "title + tags", so a tag must end at a word edge: a title that merely contains
// "@perf" or "@admin-panel" must not be rescheduled. Tags are declared in `{ tag }`, never typed into a title.
const tagged = (...names: string[]) => new RegExp(`@(?:${names.join('|')})(?![\\w-])`);
const ownProject = tagged('account', 'admin', 'visual', 'perf', 'framework'); // these have projects of their own
const phoneOnly = tagged('mobile');
// @api: no browser is involved, so running it once per browser would only repeat the same requests.
const chromiumOnly = tagged('axe', 'i18n', 'api');
const perfOnly = tagged('perf'); // measured alone, in the perf project
const notOnThisTarget = IS_SELF_HOSTED ? tagged('live-only') : tagged('self-hosted');

/**
 * Two targets (src/support/env.ts): the self-hosted Toolshop (`TARGET=local`, the default and
 * the CI gate) and the public site (`TARGET=live`, a nightly signal). The live site is shared,
 * so it gets two workers and an extra retry for its occasional 5xx; our own container gets more
 * workers and a single retry, so real flakiness is not hidden.
 *
 * Projects by tag:
 * - chromium: everything not in a project of its own; firefox / webkit: the same minus the
 *   Chromium-only suites (@axe, @i18n, @api: no browser, so once is enough);
 * - perf: @perf budgets, Chromium, one worker and no parallelism, so nothing else competes for the CPU;
 * - mobile: @smoke and @mobile on a Pixel 7;
 * - account / admin: real sign-ins from a setup project's storageState, when they may run;
 * - framework: the suite's own plumbing (the mock layer, the target configuration, the defect-id bookkeeping), Chromium, once;
 * - visual: screenshot comparisons, inside the Playwright Docker image only.
 * @self-hosted specs never run against the live site, @live-only specs only there.
 */
export default defineConfig({
  testDir: './tests',
  // Our own container answers fast, so a hung test fails early there; the shared live site gets the long budget.
  timeout: IS_SELF_HOSTED ? 45_000 : 90_000,
  expect: {
    timeout: 15_000,
    // threshold is the per-pixel colour tolerance (Playwright's default is 0.2); 0.1 flags a real colour change
    // while ignoring anti-aliasing noise, and maxDiffPixels bounds how many pixels may differ at all.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.1, maxDiffPixels: 150 },
  },
  // Baselines are Linux renderings from the official image only, so the path has no platform.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: IS_SELF_HOSTED ? 1 : 2,
  // On our own container a test that needed its retry is a flake to fix, not a green run.
  failOnFlakyTests: isCI && IS_SELF_HOSTED,
  workers: IS_SELF_HOSTED ? (isCI ? 2 : 4) : 2,
  reporter: [
    ['list'],
    isCI
      ? // One blob per CI job (REPORT_ID), so shards of different projects never overwrite each other.
        ['blob', { fileName: `report-${process.env.REPORT_ID ?? 'ci'}.zip` }]
      : ['html', { open: 'never' }],
    ['allure-playwright', { resultsDir: 'allure-results', detail: true, suiteTitle: false, environmentInfo: { target: TARGET, baseURL: BASE_URL } }],
    // Refuses perf next to other projects, and fails a live run that a bot challenge skipped too much of.
    ['./src/support/run-guard-reporter.ts'],
  ],
  use: {
    baseURL: BASE_URL,
    testIdAttribute: 'data-test',
    // Kept for every failure (retries included), not for green tests: a trace of each passing test is most of the report's size.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: IS_SELF_HOSTED ? 30_000 : 90_000,
    actionTimeout: 15_000,
  },
  projects: [
    // Real sign-ins: always on our own Toolshop, opt-in on the live site.
    ...(RUN_ACCOUNT_TESTS
      ? [
          { name: PROJECTS.accountSetup, testMatch: /account\.setup\.ts/ },
          {
            name: PROJECTS.account,
            use: { ...devices['Desktop Chrome'], storageState: CUSTOMER_STORAGE_STATE },
            grep: tagged('account'),
            grepInvert: notOnThisTarget,
            dependencies: [PROJECTS.accountSetup],
          },
        ]
      : []),
    ...(RUN_ADMIN_TESTS
      ? [
          { name: PROJECTS.adminSetup, testMatch: /admin\.setup\.ts/ },
          {
            name: PROJECTS.admin,
            use: { ...devices['Desktop Chrome'], storageState: ADMIN_STORAGE_STATE },
            grep: tagged('admin'),
            grepInvert: notOnThisTarget,
            dependencies: [PROJECTS.adminSetup],
          },
        ]
      : []),
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: [ownProject, phoneOnly, notOnThisTarget] },
    // axe, translations and the browserless @api specs are scoped to Chromium (reasons in their specs' headers).
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: [ownProject, phoneOnly, chromiumOnly, notOnThisTarget] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: [ownProject, phoneOnly, chromiumOnly, notOnThisTarget] },
    {
      // The header collapses behind a toggler below 992 px; the smoke set proves the shop still works there.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: tagged('smoke', 'mobile'),
      grepInvert: [ownProject, chromiumOnly, notOnThisTarget],
    },
    // Tests of the framework itself: they need no browser matrix, and run once.
    { name: 'framework', use: { ...devices['Desktop Chrome'] }, grep: tagged('framework'), grepInvert: notOnThisTarget },
    // Budgets are measured alone: a project of its own with a single worker. `workers: 1` limits this
    // project only, so it must also run in a pass of its own (`npm run test:perf`, its own CI job);
    // the run-guard reporter refuses a run that schedules it next to another project.
    {
      name: 'perf',
      // No trace and no video: recording perturbs TBT and INP, which are measured under 4x CPU throttling.
      use: { ...devices['Desktop Chrome'], trace: 'off', video: 'off' },
      grep: perfOnly, grepInvert: notOnThisTarget, fullyParallel: false,
      workers: 1,
    },
    // Screenshots: only inside the Playwright image (scripts/visual.sh), against our own Toolshop.
    ...(IN_PLAYWRIGHT_IMAGE && IS_SELF_HOSTED
      ? [{ name: 'visual', use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 1,
          // Pinned so a baseline never depends on the machine's locale, clock zone or motion settings.
          locale: 'en-US',
          timezoneId: 'UTC',
          colorScheme: 'light' as const,
          reducedMotion: 'reduce' as const,
        }, grep: tagged('visual') }]
      : []),
  ],
});
