// The house's own assertion helpers, which `playwright/expect-expect` (eslint.config.mjs) must count as assertions: a test
// that calls one of these asserts, because they throw. Add a new `expect*` helper here when one is written;
// tests/framework/lint-config.spec.ts fails on a name that is listed but defined nowhere, and on an `expect*` helper that is defined but not listed.
export const ASSERTION_HELPERS = [
  'expectEdits',
  'expectFixed',
  'expectLoads',
  'expectNoInjectedElements',
  'expectNoNewViolations',
  'expectNoRequest',
  'expectNoSidewaysScroll',
  'expectNotExecuted',
  'expectNoWorseShift',
  'expectPageText',
  'expectReflows',
  'expectResponsive',
  'expectVerdict',
];
