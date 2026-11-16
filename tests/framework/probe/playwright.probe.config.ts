// A throwaway config for tests/framework/fixture-teardown.spec.ts: it runs the probe specs beside it, with the suite's real
// fixtures, in a nested Playwright process, so the failure a fixture raises at TEARDOWN can be read from the report
// (a `test.fail` in the same run would accept any failure at all). Not part of the suite: nothing else matches it.
import { devices } from '@playwright/test';
import base from '../../../playwright.config';

export default {
  ...base,
  testDir: __dirname,
  testMatch: /.*\.probe\.ts/,
  globalSetup: undefined,
  retries: 0,
  workers: 1,
  maxFailures: 0,
  reporter: [['json']] as const,
  projects: [{ name: 'probe', use: { ...devices['Desktop Chrome'] } }],
};
