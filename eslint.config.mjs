// Lint for a Playwright suite: typescript-eslint for the language, eslint-plugin-playwright for the
// habits that make tests flaky (fixed sleeps, un-awaited assertions, networkidle, focused tests).
// `npm run lint` runs in the `static` job in CI. The rules the house style forbids outright
// (the "forbidden patterns" in the README) are errors here, so they cannot come back.
import js from '@eslint/js';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

const base = tseslint.config(
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
// assertions (they throw), so every one of them is listed: add a new `expect*` helper here when one is written.
const ASSERTION_HELPERS = [
  'expectFixed',
  'expectNoInjectedElements',
  'expectNoNewViolations',
  'expectNoRequest',
  'expectNotExecuted',
  'expectNoWorseShift',
  'expectPageText',
  'expectResponsive',
];
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

export default [...base, specRules, noBranches];
