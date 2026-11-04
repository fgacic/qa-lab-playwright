import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STORAGE_STATE, BASE_URL, CUSTOMER_STORAGE_STATE, IS_SELF_HOSTED, RUN_ACCOUNT_TESTS, RUN_ADMIN_TESTS, TARGET } from './src/support/env';

const isCI = !!process.env.CI;

/**
 * Two targets (src/support/env.ts): the self-hosted Toolshop (`TARGET=local`, the default and
 * the CI gate) and the public site (`TARGET=live`, a nightly signal). The live site is shared,
 * so it gets two workers and an extra retry for its occasional 5xx; our own container gets more
 * workers and a single retry, so real flakiness is not hidden.
 *
 * Projects by tag:
 * - chromium / firefox / webkit: everything except the gated real-account, real-admin and
 *   visual specs;
 * - mobile: @smoke and @mobile on a Pixel 7;
 * - account / admin: real sign-ins from a setup project's storageState;
 * - visual: screenshot comparisons, Chromium only, run inside the Playwright Docker image.
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
    { name: 'account-setup', testMatch: /account\.setup\.ts/ },
    { name: 'admin-setup', testMatch: /admin\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@account|@admin|@visual/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /@account|@admin|@visual/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: /@account|@admin|@visual/ },
    {
      // The header collapses behind a toggler below 992 px; the smoke set proves the shop still works there.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@smoke|@mobile/,
      grepInvert: /@account|@admin|@desktop|@visual/,
    },
    {
      name: 'account',
      use: { ...devices['Desktop Chrome'], storageState: CUSTOMER_STORAGE_STATE },
      grep: /@account/,
      dependencies: RUN_ACCOUNT_TESTS ? ['account-setup'] : [],
    },
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STORAGE_STATE },
      grep: /@admin/,
      dependencies: RUN_ADMIN_TESTS ? ['admin-setup'] : [],
    },
    {
      name: 'visual',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
      grep: /@visual/,
    },
  ],
});
