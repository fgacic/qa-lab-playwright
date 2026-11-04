# Playwright UI suite

End-to-end UI tests for the Toolshop demo shop (practicesoftwaretesting.com), run in GitHub Actions against a self-hosted copy of the shop, with an Allure report on GitHub Pages.

**Live report: [fgacic.github.io/qa-lab-playwright](https://fgacic.github.io/qa-lab-playwright/)**, with Allure trends across runs. The Playwright HTML report is under [/playwright](https://fgacic.github.io/qa-lab-playwright/playwright/).

The suite runs **366 tests in Chromium and 295 each in Firefox and WebKit** (the axe, translation and performance suites are Chromium-only), in 41 spec files. On top of that come:

- a 14-test smoke set on a Pixel 7;
- 13 visual baselines;
- 17 real-account and real-admin journeys.

Every control the site exposes, the back office included, is listed in [docs/COVERAGE.md](docs/COVERAGE.md) with the test that covers it.

The suite found **69 defects**, each pinned as a test:

| Kind | Count |
|---|---|
| Functional | 38 (9 of them in the back office) |
| Accessibility | 17 |
| Translation | 7 |
| Security headers | 6 |
| Performance | 1 |

## What it tests

| Area | Specs | Highlights |
|---|---|---|
| Shop | `tests/navigation`, `catalog`, `product`, `cart`, `checkout`, `contact`, `widgets` | Every header link lands where it says; search, sort, filters, pagination, compare; cart maths and discounts; **full guest purchases** with Cash on Delivery; chat and the live sales feed |
| Accounts | `tests/auth`, `tests/account` | Login (incl. TOTP), registration, password reset; **register → log in → account** for real on the self-hosted shop, mocked everywhere else |
| Back office | `tests/admin`, `tests/admin-e2e` | Every admin list, form, status change, report and setting against a mocked admin API; **real journeys** as the seeded admin: create → sell → reprice → delete a product, ship an order, answer a message |
| Failure paths | every area | Each request the UI sends also answers 500, 4xx, a network abort, and an empty 200 |
| Accessibility | `tests/a11y` | axe-core WCAG 2.2 A/AA on 32 pages and states; 13 known violations pinned one by one |
| Visual | `tests/visual` | 13 screenshots of key pages and states, compared in the official Playwright image |
| Translations | `tests/i18n` | 10 pages and form states in all 7 languages: no leaked keys, no stray English |
| Security | `tests/security` | Script and HTML payloads through search, chat, contact, registration and admin forms are shown as text, never run; live response headers |
| Performance | `tests/performance` | LCP, TBT and an INP proxy per key page against Core Web Vitals limits; CLS on a slow API |

Tags pick subsets: `@smoke`, `@negative`, `@mocked`, `@flow`, `@bug`, `@a11y`, `@axe`, `@visual`, `@i18n`, `@security`, `@perf`, `@mobile`, `@account`, `@admin`.

Tags also decide where a spec is scheduled, in `playwright.config.ts`, so nothing is skipped at run time:
- `@axe`, `@i18n` and `@perf` run on Chromium only;
- `@mobile` runs only on the phone project;
- `@self-hosted` never runs on live, and `@live-only` runs only there.

The Chromium count (366) is therefore not 379 on every browser: Firefox and WebKit run 295 each.

Allure labels are derived in one fixture (`fixtures/allure-labels.ts`):
- epic from the spec folder, feature from the file, story from the innermost describe;
- severity from the tags (`@flow` blocker, `@smoke` critical);
- layer `e2e` / `integration` (mocked) / `visual`.

## Why these cases

- **Our own shop as the gate.** CI builds Toolshop from source at a pinned commit, the one the public site runs, and seeds it fresh for every job. Results come from the code under test, not from other people's data or a shared server's mood. Real sign-ins, attack payloads, screenshots and performance budgets run there and only there. The public site gets a nightly read-only run as a signal.
- **One rule per feature: positive, negative, failing API, empty API.** That is where most defects were: the shop handles the happy path and often goes silent on errors.
- **The UI is checked against the API, not against hard-coded data.** A filter test asserts three things: the request carries the filter, the API's answer honours it, and the grid shows exactly that answer. Products are looked up at runtime.
- **Arrange through the API, act through the UI.** Carts, guest orders, favourites and contact messages are created through the API. A test only clicks through what it is about.
- **Known defects are tests, not notes.** `knownBug('BUG-14', …)` wraps `test.fail`. The spec states the correct behaviour, and it goes red the day the site is fixed. A CI job (`npm run test:verify-bugs`) runs them all as plain tests and fails if one of them passes.
- **Each layer says what it proves.** Mocked admin specs prove the UI's behaviour on given responses, and a guard refuses any unmocked write. The admin e2e specs prove the real backend. The axe scan runs on a baseline, so it catches both regressions and fixes. CLS is measured where it is deterministic (see Performance in COVERAGE.md).
- **Safe on the public site.** No real accounts, sign-ins or submitted payloads, at most 2 workers. No card, bank or gift-card number is ever typed anywhere, not even a fake one. Orders use Cash on Delivery with `example.com` guests.

## How to run

Requires Node 22 and Docker.

```bash
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run toolshop:up                  # build, start, seed and health-check the shop

npm test                             # everything against the self-hosted shop
npx playwright test --project=webkit # one browser
npm run test:smoke | test:a11y | test:i18n | test:security | test:perf
npm run test:account                 # real customer journeys (setup project signs in)
npm run test:admin                   # real back-office journeys as the seeded admin
npm run test:visual                  # screenshots, inside mcr.microsoft.com/playwright:v1.64.1-noble
npm run test:visual:update           # re-record the baselines in that image, then commit them
npm run test:verify-bugs             # every pinned defect must still fail
npm run toolshop:reseed              # fresh data between local runs
npm run toolshop:down
npm run report                       # Allure 3 report from allure-results/
```

**The public site:** `npm run test:live` (`TARGET=live`). There, real-account and admin journeys stay off unless `RUN_ACCOUNT_TESTS=1` / `RUN_ADMIN_TESTS=1` (with `ADMIN_EMAIL`, `ADMIN_PASSWORD`), and payload, visual and performance specs never run. `BASE_URL` / `API_URL` point either target elsewhere.

## Latest runs

- **Gate:** [CI 41812346305](https://github.com/fgacic/qa-lab-playwright/actions/runs/41812346305), report #7. 1,000 of 1,000 passed, 0 skipped, 0 global errors; verify-bugs: 72 of 72 pins still fail.
- **Live:** [Live site 41808674880](https://github.com/fgacic/qa-lab-playwright/actions/runs/41808674880). 330 passed. The 13 failures come from Cloudflare challenging the runner's requests; the same specs pass from a home connection.
- **History:** all runs are listed in [COVERAGE.md](docs/COVERAGE.md#runs).

## How the CI works

`.github/workflows/ci.yml` runs on every push and pull request, nightly at 03:17 UTC, and on demand. It is the gate, against the self-hosted shop.

1. **typecheck.** `tsc --noEmit`.
2. **e2e.** An 8-job matrix:
   - Chromium in 3 shards, Firefox in 2, WebKit in 2;
   - one job for the real account and admin projects plus the mobile smoke set.

   Each job restores npm and the Playwright browsers from cache, then builds Toolshop with `docker/bake-action` and a GitHub Actions layer cache. The cache means the PHP extensions and the Angular build only rebuild when the pinned commit changes. The job then starts the stack (`scripts/toolshop.sh`), runs its shard, and uploads a blob report and its Allure results.
3. **visual.** Same stack. The screenshots are compared inside `mcr.microsoft.com/playwright:v1.64.1-noble`, the image the baselines were recorded in, so fonts and rendering match.
4. **verify-bugs.** Runs every `knownBug` spec as a plain test. It must fail; one that passes means a defect was fixed.
5. **merge reports.** Downloads every blob and merges them into one HTML report. It then fetches the published Allure `history/history.jsonl`, generates the Allure 3 report (which appends this run to the history), and assembles the site.
6. **publish.** From `main` only, with `actions/deploy-pages`. The history file is published with the report, which is how the Trend, Duration and Retries charts keep growing.

`.github/workflows/live.yml` runs the suite against practicesoftwaretesting.com nightly and on demand, as a signal and not a gate. It runs Chromium and the mobile set, one job at a time, so at most two workers touch the public site. Cloudflare answers part of the runner's navigations with a bot challenge. The suite never tries to get past it: a test whose own navigation is challenged is skipped with that reason, and any other test the challenge interrupts carries a `bot challenge` annotation in the report.

The rest of the setup:

- **Actions** are pinned to commit SHAs.
- **Concurrency** cancels superseded pull-request runs, and Pages deploys are serialised.
- **No secrets.** None is needed: the only accounts used are the self-hosted shop's seeded test accounts.

## Structure

```
docker/, docker-compose.yml, .env.toolshop   the self-hosted Toolshop, pinned
src/components/   Header, FilterPanel, ProductGrid, CartTable, checkout steps, admin table and search, FormField…
src/pages/        thin pages composing components; actions return the next page
src/support/      env (targets), @step, ApiMock, ToolshopApi, payloads, test data, knownBug, i18n, a11y baseline
fixtures/         api · mocks · pages · auth · admin · a11y · security · performance · matchers → index.ts (mergeTests, mergeExpects)
tests/            specs by area; tests/setup/* sign in and write storageState
docs/COVERAGE.md  every control, its test, the bug list, and run results
```

- **Fixtures inject page objects.** Tests destructure `{ homePage, productPage, checkout }`. The fixture does the setup (a seeded cart, a comparison, a session, mocks) and opens the page; no test calls `new`. Options change the setup per describe block, for example `test.use({ productKind: 'out-of-stock' })`, `test.use(withMocks(mock.fail('QUERY', '/products')))` or `test.use({ apiLatencyMs: 500 })`.
- **Composition, not inheritance.** No BasePage. Components take a root `Locator`. Pages hold an `AppShell`, and admin forms an `AdminFormChrome`.
- **User-facing locators.** `getByRole` and `getByLabel` first. `getByTestId` (`data-test`) only where no role or label is unique: error labels, the cart badge, and buttons whose names change with the language. CSS only where the markup leaves no other handle, each case commented.
- **Methods say what the user does.** Examples are `filters.filterByCategory('Pliers')` and `checkout.payment.payWith('cash-on-delivery')`. Each is wrapped in `test.step` by a `@step` decorator.
- **Sessions.** `mocked` (fake JWT) runs everywhere. `storage-state` comes from a setup project. `worker-account` gives each worker its own customer. Toolshop's JWT lives 300 s and cannot be refreshed, so real sessions get a fresh token per test.

## What broke

Everything is listed in [docs/COVERAGE.md](docs/COVERAGE.md#bugs-found). The headlines:

- **Silent failures everywhere.** A failed product list, cart, product, rentals, favourites, search or admin list leaves a blank area or a misleading empty state. A rejected order still says "Payment was successful" (BUG-17).
- **Data and validation.**
  - A failed quantity update leaves line and cart totals disagreeing (BUG-14).
  - A future birth date is accepted (BUG-18).
  - Credit Card and Buy Now Pay Later can be checked with nothing filled in (BUG-16, BUG-29).
  - Searches over 40 characters are silently dropped (BUG-27).
  - A full-name search fails when the name has a word under 3 letters (BUG-28).
- **Back office** (ADM-01..09):
  - Delete never asks for confirmation.
  - Prices are not validated.
  - The edit form drops stock, brand, category and image, so an existing product cannot be saved as loaded.
- **Sessions.** `/users/refresh` throws an unhandled exception (500), so every session ends after 5 minutes.
- **Raw text leaks:** "[object Object]", "true", `page.forgot-password.confirm` (BUG-20, 21, 22).
- **Untranslated text.** Seven areas stay English in all six other languages (I18N-01..07): the notification bar, the screen-reader heading, the footer, "Sign in with Google", the registration help, the privacy page, and the hard-coded "Quantity".
- **Accessibility.** 13 axe violations, 6 of them critical:
  - the checkout tabs break the ARIA tab pattern;
  - three password buttons have no name;
  - the language button's name does not match its "EN" label;
  - the related-products links are too small to tap.

  Four more defects were found by locator friction: the cart remove control, Sign out, and pagination that is disabled by CSS only.
- **Security headers.** The live site sends no CSP, X-Frame-Options, nosniff, Referrer-Policy or HSTS, and the API names its server and OS versions (SEC-01..06).
- **Performance.** The footer renders before the page content and jumps (CLS 0.11 to 0.38, PERF-01). LCP, TBT and INP are well inside budget.
- **Test-design lessons.**
  - `test.use()` reads a two-element array as `[value, options]`, so mocks are an object.
  - Fixture-driven navigation needs settle waits, or a late initial response overwrites the test's first search.
  - Laravel caches product lists across a reseed.
  - The pinned tag 2.5 differs from what the live site runs, hence building from a commit.
  - Six chat "contrast" findings were the scan catching a fade-in. Scan settled states only.

## What I would change

- **Run axe on Firefox and WebKit too, each with its own baseline.** Today it runs on Chromium only, because the engines disagree in edge cases.
- **Contract-check the mocks.** The payloads mirror the OpenAPI document by hand. A job validating them against the spec would catch drift before mocked tests start lying.
- **Publish the nightly live run** next to the gate's report, for example under `/live`, with its own Allure history.
- **Let Renovate** bump the pinned action SHAs, base images and the Toolshop commit, each through its own pull request run.

---
Tools: Playwright, TypeScript, GitHub Actions, Allure · Part of the [qa-lab](https://github.com/fgacic?tab=repositories&q=topic:qa-lab) series.
