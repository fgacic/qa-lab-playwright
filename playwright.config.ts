import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STORAGE_STATE, BASE_URL, CUSTOMER_STORAGE_STATE, IS_SELF_HOSTED, RUN_ACCOUNT_TESTS, RUN_ADMIN_TESTS, TARGET } from './src/support/env';

const isCI = !!process.env.CI;
const IN_PLAYWRIGHT_IMAGE = process.env.PLAYWRIGHT_DOCKER === '1';

/**
 * Where a spec may run is decided here, by tag, never by a runtime skip: a test that cannot run
 * in a project is not scheduled there at all, so reports count only real results.
 */
const ownProject = /@account|@admin|@visual/; // these have projects of their own
const phoneOnly = /@mobile/;
const chromiumOnly = /@axe|@i18n|@perf/;
const notOnThisTarget = IS_SELF_HOSTED ? /@live-only/ : /@self-hosted/;

/**
 * Two targets (src/support/env.ts): the self-hosted Toolshop (`TARGET=local`, the default and
 * the CI gate) and the public site (`TARGET=live`, a nightly signal). The live site is shared,
 * so it gets two workers and an extra retry for its occasional 5xx; our own container gets more
 * workers and a single retry, so real flakiness is not hidden.
 *
 * Projects by tag:
 * - chromium: everything not in a project of its own; firefox / webkit: the same minus the
 *   Chromium-only suites (@axe, @i18n, @perf);
 * - mobile: @smoke and @mobile on a Pixel 7;
 * - account / admin: real sign-ins from a setup project's storageState, when they may run;
 * - visual: screenshot comparisons, inside the Playwright Docker image only.
 * @self-hosted specs never run against the live site, @live-only specs only there.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 },
  },
  // Baselines are Linux renderings from the official image only, so the path has no platform.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: IS_SELF_HOSTED ? 1 : 2,
  workers: IS_SELF_HOSTED ? (isCI ? 2 : 4) : 2,
  reporter: isCI
    ? // One blob per CI job (REPORT_ID), so shards of different projects never overwrite each other.
      [['list'], ['blob', { fileName: `report-${process.env.REPORT_ID ?? 'ci'}.zip` }], ['allure-playwright', { resultsDir: 'allure-results', detail: true, suiteTitle: false, environmentInfo: { target: TARGET, baseURL: BASE_URL } }]]
    : [['list'], ['html', { open: 'never' }], ['allure-playwright', { resultsDir: 'allure-results', detail: true, suiteTitle: false, environmentInfo: { target: TARGET, baseURL: BASE_URL } }]],
  use: {
    baseURL: BASE_URL,
    testIdAttribute: 'data-test',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: IS_SELF_HOSTED ? 30_000 : 90_000,
    actionTimeout: 15_000,
  },
  projects: [
    // Real sign-ins: always on our own Toolshop, opt-in on the live site.
    ...(RUN_ACCOUNT_TESTS
      ? [
          { name: 'account-setup', testMatch: /account\.setup\.ts/ },
          {
            name: 'account',
            use: { ...devices['Desktop Chrome'], storageState: CUSTOMER_STORAGE_STATE },
            grep: /@account/,
            grepInvert: notOnThisTarget,
            dependencies: ['account-setup'],
          },
        ]
      : []),
    ...(RUN_ADMIN_TESTS
      ? [
          { name: 'admin-setup', testMatch: /admin\.setup\.ts/ },
          {
            name: 'admin',
            use: { ...devices['Desktop Chrome'], storageState: ADMIN_STORAGE_STATE },
            grep: /@admin/,
            grepInvert: notOnThisTarget,
            dependencies: ['admin-setup'],
          },
        ]
      : []),
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: [ownProject, phoneOnly, notOnThisTarget] },
    // axe, translations and performance are scoped to Chromium (reasons in their specs' headers).
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: [ownProject, phoneOnly, chromiumOnly, notOnThisTarget] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: [ownProject, phoneOnly, chromiumOnly, notOnThisTarget] },
    {
      // The header collapses behind a toggler below 992 px; the smoke set proves the shop still works there.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@smoke|@mobile/,
      grepInvert: [ownProject, chromiumOnly, notOnThisTarget],
    },
    // Screenshots: only inside the Playwright image (scripts/visual.sh), against our own Toolshop.
    ...(IN_PLAYWRIGHT_IMAGE && IS_SELF_HOSTED
      ? [{ name: 'visual', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, grep: /@visual/ }]
      : []),
  ],
});
