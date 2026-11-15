// Lint for a Playwright suite: typescript-eslint for the language, eslint-plugin-playwright for the
// habits that make tests flaky (fixed sleeps, un-awaited assertions, networkidle, focused tests).
// `npm run lint` is part of the typecheck job in CI. The rules the house style forbids outright
// (CLAUDE-style "forbidden patterns" in the README) are errors here, so they cannot come back.
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', setTimeout: 'readonly' } } },

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
      // `expect(page).toHaveURL(...)` etc. live in specs by house style; page objects and fixtures assert only in the places they say.
      'playwright/expect-expect': 'off',
    },
  },
);

// A test that branches can pass without ever reaching its assertion, so specs may not: encode the case in
// the data (a table of cases, a tag, a project) instead. Fixtures and setup files are not tests: a setup
// narrows its inputs with an explicit throw, and a fixture's `use()` code legitimately branches.
const noBranches = {
  files: ['tests/**/*.spec.ts'],
  rules: { 'playwright/no-conditional-in-test': 'error', 'playwright/no-conditional-expect': 'error' },
};

export default [...base, noBranches];
