import { defineConfig, devices } from '@playwright/test';
import { CUSTOMER_STORAGE_STATE } from './src/support/env';

const isCI = !!process.env.CI;
const runAccountTests = process.env.RUN_ACCOUNT_TESTS === '1';

/**
 * The target is a live, shared, public practice shop. Every setting below follows from that:
 * - retries absorb the occasional 5xx from the shared backend (seen on POST /carts),
 * - two workers at most, to be polite to a site other people are testing too,
 * - generous navigation timeout: a cold first load has taken over 30 s.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['allure-playwright', { resultsDir: 'allure-results', detail: true, suiteTitle: false }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://practicesoftwaretesting.com',
    testIdAttribute: 'data-test',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 90_000,
    actionTimeout: 15_000,
  },
  projects: [
    // Signs in a real account and saves storageState. Runs only with RUN_ACCOUNT_TESTS=1.
    { name: 'account-setup', testMatch: /account\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@account/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grepInvert: /@account/,
    },
    {
      // The header collapses behind a toggler below 992 px; the smoke set proves the shop still works there.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@smoke|@mobile/,
      grepInvert: /@account|@desktop/,
    },
    {
      name: 'account',
      use: { ...devices['Desktop Chrome'], storageState: CUSTOMER_STORAGE_STATE },
      grep: /@account/,
      dependencies: runAccountTests ? ['account-setup'] : [],
    },
  ],
});
