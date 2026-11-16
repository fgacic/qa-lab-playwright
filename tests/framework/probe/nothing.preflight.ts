// Run only by tests/framework/preflight.spec.ts: reached only when the preflight let the run start.
import { expect, test } from '@playwright/test';

test('probe: the run started', () => {
  expect(true).toBe(true);
});
