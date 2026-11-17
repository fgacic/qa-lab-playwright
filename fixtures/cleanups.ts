import { test as base } from '@playwright/test';

/** One removal of something a test made, run when the test is over. */
export type Cleanups = (() => Promise<void>)[];

/**
 * `cleanups`: the one place a security spec lists what it made in the shared database, so every spec removes it the same way. Push a
 * removal BEFORE the write that makes the record (a save whose answer never arrives still leaves nothing behind), and find the record by
 * something the test declared (a name, an e-mail), not by an id the answer would have given. Each entry runs after the test, last made first,
 * pass or fail; one that throws does not stop the others, and the failures are raised together at the end.
 *
 * A pin is an expected failure, and an expected failure swallows a teardown error along with the bug's own: the throw would end in a
 * green "expected to fail". Each failure is therefore also written into the test's annotations, which the report keeps either way, so a
 * record that leaked from a pin is never silent. (verify-bugs.mjs additionally refuses a pin whose errors do not come from the spec.)
 * Fixtures are torn down in the reverse order of their set-up, so a fixture whose removals use `request`, `api` or `adminToken` lists
 * `cleanups` AFTER them (it is then torn down first, while they still work). It needs no page, so a spec on `apiOnlyTest` merges
 * `cleanupTest` in alone.
 */
export const cleanupTest = base.extend<{ cleanups: Cleanups }>({
  cleanups: async ({}, use, testInfo) => {
    const cleanups: Cleanups = [];
    await use(cleanups);
    const failures: unknown[] = [];
    for (const cleanup of [...cleanups].reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const failure of failures) testInfo.annotations.push({ type: 'cleanup failed', description: String(failure instanceof Error ? failure.message : failure) });
    if (failures.length) throw new AggregateError(failures, `${failures.length} record(s) made by the test could not be removed`);
  },
});
