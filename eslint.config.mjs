// Lint for a Playwright suite: typescript-eslint for the language, eslint-plugin-playwright for the
// habits that make tests flaky (fixed sleeps, un-awaited assertions, networkidle, focused tests).
// `npm run lint` runs in the `static` job in CI. The rules the house style forbids outright
// (the "forbidden patterns" in the README) are errors here, so they cannot come back.
import js from '@eslint/js';
import playwright from 'eslint-plugin-playwright';
import { ASSERTION_HELPERS } from './scripts/lib/assertion-helpers.mjs';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const base = defineConfig(
  { ignores: ['node_modules/', 'playwright-report/', 'test-results/', 'blob-report/', 'allure-results/', 'allure-report/', '.auth/'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // A floating promise in a test is an action that races the next line, or an assertion that never ran.
      '@typescript-eslint/no-floating-promises': 'error',
      // An async function where a sync callback is expected (an event handler, `forEach`, a `.filter`) is a floating promise
      // the first rule cannot see; `await` on a non-promise is a missing call, or a mock that is not what the test thinks it is.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', setTimeout: 'readonly', AbortSignal: 'readonly' } } },

  {
    ...playwright.configs['flat/recommended'],
    files: ['tests/**/*.ts', 'fixtures/**/*.ts', 'src/**/*.ts'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      'playwright/missing-playwright-await': 'error',
      'playwright/no-networkidle': 'error',
      'playwright/no-page-pause': 'error',
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/no-force-option': 'error',
      // Tags are declared in `{ tag }` (playwright.config.ts greps them), never typed into a title, where they would also be reported twice.
      'playwright/valid-title': ['error', { mustNotMatch: '@\\w' }],
      // Blank-line style is not a correctness rule; the formatter of the day decides it.
      'playwright/no-conditional-in-test': 'off', // on for specs only, below
      'playwright/no-conditional-expect': 'off',
      'playwright/consistent-spacing-between-blocks': 'off',
      // Assertions live in specs by house style; page objects and fixtures assert only in the places they say.
      // `expect-expect` is on for specs only, below.
      'playwright/expect-expect': 'off',
    },
  },
);

// A test with no assertion passes whatever the shop does. The house's own assertion helpers count as
// assertions (they throw), so every one of them is listed in scripts/lib/assertion-helpers.mjs, and
// tests/framework/lint-config.spec.ts checks the list against the code in both directions.
const specRules = {
  files: ['tests/**/*.spec.ts'],
  rules: {
    'playwright/expect-expect': ['error', { assertFunctionNames: ASSERTION_HELPERS }],
    // describe > describe is the deepest a spec reads well: more is a file that wants splitting.
    'playwright/max-nested-describe': ['error', { max: 2 }],
  },
};

// A test that branches can pass without ever reaching its assertion, so specs may not: encode the case in
// the data (a table of cases, a tag, a project) instead. Fixtures and setup files are not tests: a setup
// narrows its inputs with an explicit throw, and a fixture's `use()` code legitimately branches.
const noBranches = {
  files: ['tests/**/*.spec.ts'],
  rules: { 'playwright/no-conditional-in-test': 'error', 'playwright/no-conditional-expect': 'error' },
};

// Things a spec may not write inline, each with the named helper that is the one place allowed to (the helpers live in
// src/support and fixtures, which this block does not cover, so there is never a disable comment to hunt for):
// - code run inside the page (evaluate and its relatives, below): it is untyped, unretried and invisible to the report. A spec states what the user
//   sees; what the app stored or sent is read through `storedToken` (src/support/session.ts), the mock layer, or a helper
//   such as `fetchStatus` (src/support/page-fetch.ts), which names what it does.
// - a hard-coded http(s):// URL: addresses come from env.ts (BASE_URL, API_URL), so a spec cannot quietly aim at another
//   server. A case table that needs a made-up host builds it with `httpUrl` (src/support/urls.ts).
// - Math.random / Date.now / new Date() / performance.now(): a spec's data is derived from `test-data.ts` (seeded and unique) and its timing from the
//   framework, so a failure can be replayed. Timing under test goes through `elapsedMs` (src/support/page-fetch.ts).
// - serial describes: tests that depend on each other's order hide which one broke and cannot be sharded or retried alone;
//   arrange the state each test needs through the API instead.
// Code run inside the page, on any object: `page.evaluate`, `locator.evaluate` / `evaluateAll`, `handle.evaluate` / `evaluateHandle`,
// `page.$eval` / `$$eval`, `waitForFunction`, and `addInitScript` (a script that runs in every page of the tab or context). A name is matched whatever the receiver is called, because a locator, a frame or a
// JSHandle (`message.args()[0].evaluate(...)`) is as untyped, unretried and invisible to the report as `page` is.
const IN_PAGE_CODE = "CallExpression[callee.property.name=/^(evaluate|evaluateAll|evaluateHandle|\\$eval|\\$\\$eval|waitForFunction|addInitScript)$/]";
const noInlineHazards = {
  files: ['tests/**/*.spec.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: IN_PAGE_CODE,
        message: 'No code run in the page in a spec (evaluate, evaluateAll, evaluateHandle, $eval, $$eval, waitForFunction, addInitScript): read or seed what the app stores through a named helper (storedToken, installToken, seedTabCart and seedTabComparison in @support/session, fetchStatus in @support/page-fetch, consoleArgsText in @support/console-guard for the arguments of a console message) or assert what the user sees.',
      },
      {
        selector: "Literal[value=/^https?:\\/\\//], TemplateElement[value.raw=/https?:\\/\\//]",
        message: 'No hard-coded http(s):// URL in a spec: use BASE_URL / API_URL from @support/env, or httpUrl() from @support/urls for a made-up host.',
      },
      {
        selector: "MemberExpression[object.name='Math'][property.name='random']",
        message: 'No Math.random in a spec: unique data comes from @support/test-data (uniqueEmail, fakeCustomer, ...).',
      },
      {
        selector: "MemberExpression[object.name='Date'][property.name='now']",
        message: 'No Date.now in a spec: time what you must with elapsedMs (@support/page-fetch); unique data comes from @support/test-data.',
      },
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'No new Date() in a spec: it is the clock of the machine, so a failure cannot be replayed. A date under test is a fixed value or comes from @support/test-data; the page clock is page.clock.',
      },
      {
        selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']",
        message: 'No performance.now() in a spec: time what you must with elapsedMs (@support/page-fetch).',
      },
      {
        selector: "MemberExpression[object.property.name='describe'][property.name='serial']",
        message: 'No serial describe: tests that need each other\'s order cannot be retried or sharded alone. Arrange each test\'s state through the API.',
      },
      {
        selector: "CallExpression[callee.property.name='configure'] Property[key.name='mode'][value.value='serial']",
        message: "No configure({ mode: 'serial' }): tests that need each other's order cannot be retried or sharded alone. Arrange each test's state through the API.",
      },
    ],
  },
};

export default [...base, specRules, noBranches, noInlineHazards];
