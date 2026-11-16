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
// - page.evaluate: code run inside the page is untyped, unretried and invisible to the report. A spec states what the user
//   sees; what the app stored or sent is read through `storedToken` (src/support/session.ts), the mock layer, or a helper
//   such as `fetchStatus` (src/support/page-fetch.ts), which names what it does.
// - a hard-coded http(s):// URL: addresses come from env.ts (BASE_URL, API_URL), so a spec cannot quietly aim at another
//   server. A case table that needs a made-up host builds it with `httpUrl` (src/support/urls.ts).
// - Math.random / Date.now: a spec's data is derived from `test-data.ts` (seeded and unique) and its timing from the
//   framework, so a failure can be replayed. Timing under test goes through `elapsedMs` (src/support/page-fetch.ts).
// - serial describes: tests that depend on each other's order hide which one broke and cannot be sharded or retried alone;
//   arrange the state each test needs through the API instead.
// `page.evaluate(...)`, and `somePageObject.page.evaluate(...)`.
const PAGE_EVALUATE = "CallExpression[callee.property.name=/^(evaluate|evaluateHandle)$/][callee.object.name=/^page$/i], CallExpression[callee.property.name=/^(evaluate|evaluateHandle)$/][callee.object.property.name='page']";
const noInlineHazards = {
  files: ['tests/**/*.spec.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: PAGE_EVALUATE,
        message: 'No page.evaluate in a spec: read what the app stored through a named helper (storedToken in @support/session, fetchStatus in @support/page-fetch) or assert what the user sees.',
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
