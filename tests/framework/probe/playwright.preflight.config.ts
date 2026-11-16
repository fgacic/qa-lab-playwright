// A throwaway config for tests/framework/toolshop-health.spec.ts: the suite's real `globalSetup` (src/support/preflight.ts) in front of one
// empty test, run in a nested Playwright process against whatever address the spec put in BASE_URL / API_URL / TARGET.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.preflight\.ts/,
  globalSetup: '../../../src/support/preflight.ts',
  retries: 0,
  workers: 1,
  reporter: [['line']],
});
