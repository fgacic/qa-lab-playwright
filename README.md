# Playwright UI suite

End-to-end UI tests for the Toolshop demo shop (practicesoftwaretesting.com), run in GitHub Actions against a self-hosted copy of the shop, with an Allure report on GitHub Pages.

**Live report: [fgacic.github.io/qa-lab-playwright](https://fgacic.github.io/qa-lab-playwright/)**, with Allure trends across runs. The Playwright HTML report is under [/playwright](https://fgacic.github.io/qa-lab-playwright/playwright/).

The suite runs **665 tests in Chromium and 363 each in Firefox and WebKit** (the axe and translation suites are Chromium-only), in 42 spec files. On top of that come:

- 9 performance budgets, measured alone in a project of their own;
- a 16-test smoke set on a Pixel 7;
- 17 visual baselines (18 tests: one more checks that no baseline on disk is orphaned);
- 17 tests in the real-account and real-admin projects: 15 journeys and the 2 sign-ins they start from.

Every control the site exposes, the back office included, is listed in [docs/COVERAGE.md](docs/COVERAGE.md) with the test that covers it.

The suite found **91 defects**, each pinned as a test:

| Kind | Count |
|---|---|
| Functional | 47 (12 of them in the back office) |
| Accessibility | 17 |
| Translation | 20 |
| Security headers | 6 |
| Performance | 1 |

## What it tests

| Area | Specs | Highlights |
|---|---|---|
| Shop | `tests/navigation`, `catalog`, `product`, `cart`, `checkout`, `contact`, `widgets` | Every header link lands where it says; search, sort, filters, pagination, compare; cart maths and discounts; **full guest purchases** with Cash on Delivery; chat and the live sales feed |
| Accounts | `tests/auth`, `tests/account` | Login (incl. TOTP), registration, password reset; **register → log in → account** for real on the self-hosted shop, mocked everywhere else |
| Back office | `tests/admin`, `tests/admin-e2e` | Every admin list, form, status change, report and setting against a mocked admin API; **real journeys** as the seeded admin: create → sell → reprice → delete a product, ship an order, answer a message |
| Failure paths | every area | Each request the UI sends also answers 500, 4xx, a network abort, and an empty 200; the back office reports a failed reply, status save or refused save, or the test pins that it does not |
| Accessibility | `tests/a11y` | axe-core WCAG 2.2 A/AA on 40 pages and states; 13 known violations pinned one by one, and the baseline is a ratchet: a fix or a spread both fail until it is updated |
| Visual | `tests/visual` | 17 screenshots of key pages and states (out-of-stock product, checkout payment, admin orders and an order among them), compared in the official Playwright image |
| Translations | `tests/i18n` | 18 pages and states in all 7 languages (the cart with lines, checkout billing and payment, a toast, the chat, the language menu, an unknown product): visible text, `<title>`, labels, placeholders, alt text and options. No leaked keys, no stray English |
| Security | `tests/security` | Script and HTML payloads through search, chat, contact, registration, admin forms and route segments (`/category/<payload>`, `/product/<payload>`) are shown as text, never run, watched by a sentinel that is itself tested (popups and other tabs included, with a control for every payload); live response headers by value |
| Performance | `tests/performance` | LCP, TBT (long tasks before the first input) and an INP proxy per key page against Core Web Vitals limits and against a baseline recorded per environment (`ci` or `local`), the median of 3 throttled cold loads; CLS on a slow API |

Tags pick subsets: `@smoke`, `@negative`, `@mocked`, `@flow`, `@bug`, `@a11y`, `@axe`, `@visual`, `@i18n`, `@security`, `@perf`, `@mobile`, `@account`, `@admin`.

Tags also decide where a spec is scheduled, in `playwright.config.ts`, so nothing is skipped at run time:
- `@axe` and `@i18n` run on Chromium only, and `@perf` in its own one-worker `perf` project;
- `@mobile` runs only on the phone project;
- `@self-hosted` never runs on live, and `@live-only` runs only there.

Guards in the framework, so a run cannot quietly prove nothing:
- An unknown `TARGET` throws, and `TARGET=local` with a non-local `BASE_URL` / `API_URL` throws.
- A run that schedules `perf` next to another project is refused (`src/support/run-guard-reporter.ts`).
- On live, a run fails if more than 20% of its tests were skipped for the bot challenge.
- Every page test asserts at teardown that `apiMock.blockedWrites` is empty: a write no mock answers is refused, and fails the test. The write guard is on by default for the live target; anonymous cart writes (add to cart, cart edits) are allowed there as arrange steps.
- `apiMock` is not an auto fixture: a test that mocks says so.
- The self-hosted test timeout is 45 s, so a hung test fails early; live gets 90 s.


Allure labels are derived in one fixture (`fixtures/allure-labels.ts`):
- epic from the spec folder, feature from the file, story from the innermost describe;
- severity from the tags (`@flow` blocker, `@smoke` critical);
- layer `e2e` / `integration` (mocked) / `visual`.

## Why these cases

- **Our own shop as the gate.** CI builds Toolshop from source at a pinned commit, the one the public site runs, and seeds it fresh for every job. Results come from the code under test, not from other people's data or a shared server's mood. Real sign-ins, attack payloads, screenshots and performance budgets run there and only there. A read-only run against the public site exists but is disabled (see below).
- **One rule per feature: positive, negative, failing API, empty API.** That is where most defects were: the shop handles the happy path and often goes silent on errors.
- **The UI is checked against the API, not against hard-coded data.** A filter test asserts three things: the request carries the filter, the API's answer honours it, and the grid shows exactly that answer. Products are looked up at runtime.
- **Arrange through the API, act through the UI.** Carts, guest orders, favourites and contact messages are created through the API. A test only clicks through what it is about.
- **Known defects are tests, not notes.** `knownBug('BUG-14', …)` wraps `test.fail`. The spec states the correct behaviour, and it goes red the day the site is fixed. A CI job (`npm run test:verify-bugs`) runs them all as plain tests and fails if one of them passes.
- **Each layer says what it proves.** Mocked admin specs prove the UI's behaviour on given responses, and a guard refuses any unmocked write. The admin e2e specs prove the real backend. The axe scan runs on a baseline, so it catches both regressions and fixes. CLS is measured where it is deterministic (see Performance in COVERAGE.md).
- **Safe on the public site.** No real accounts, sign-ins or submitted payloads, at most 2 workers, and a write guard that refuses any write no mock answers. The one write it allows is an anonymous cart (add to cart, cart edits), made as an arrange step. No card, bank or gift-card number is ever typed anywhere, not even a fake one. Orders use Cash on Delivery with `example.com` guests, and only on the self-hosted shop.

## How to run

Requires Node 22 and Docker.

```bash
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run toolshop:up                  # build, start, seed and health-check the shop

npm test                             # everything against the self-hosted shop, in three passes as in CI:
                                     # the browsers; perf alone, so nothing competes for the CPU it measures;
                                     # then the real sessions, because a Toolshop token lives 300 s and cannot be renewed
npm run test:parallel                # the browsers pass only, with more workers; self-hosted shop only (TARGET=local)
npx playwright test --project=webkit # one browser
npm run test:smoke | test:a11y | test:i18n | test:security | test:perf
npm run test:account                 # real customer journeys (setup project signs in)
npm run test:admin                   # real back-office journeys as the seeded admin
npm run test:visual                  # screenshots, inside mcr.microsoft.com/playwright:v1.64.1-noble
npm run test:visual:update           # re-record the baselines in that image, then commit them
npm run test:verify-bugs             # every pinned defect must still fail, each for its own reason
UPDATE_PERF_BASELINE=1 npm run test:perf   # re-record this machine's `local` performance baseline (idle machine, load average under 4)
npm run toolshop:reseed              # fresh data between local runs
npm run toolshop:down
npm run report                       # Allure 3 report from allure-results/
```

**Performance baselines.** `tests/performance/baseline.json` holds one set of medians per environment: `ci` when `CI` is set, otherwise `local`. A run enforces the baseline limit (median plus 30%, with a noise floor per metric) only when an entry for its environment exists. Without one it attaches the measured medians with the note "no baseline for <env>: record with UPDATE_PERF_BASELINE=1", and the absolute Core Web Vitals budgets still apply. To record the `ci` set, run the CI workflow by hand (Actions, "Run workflow") with **record_perf_baseline** ticked. The `record-perf-baseline` job measures on a runner and uploads `baseline.json` as the `perf-baseline-ci` artifact. Merging it is a human step: download the artifact, review the diff, and commit the file.

**The public site:** `npm run test:live` (`TARGET=live`). There, real-account and admin journeys stay off unless `RUN_ACCOUNT_TESTS=1` / `RUN_ADMIN_TESTS=1` (with `ADMIN_EMAIL`, `ADMIN_PASSWORD`), and payload, visual and performance specs never run. `BASE_URL` / `API_URL` point either target elsewhere.

## Latest runs

- **Gate:** [CI 41812346305](https://github.com/fgacic/qa-lab-playwright/actions/runs/41812346305), report #7, the last published run, from before the second review round (its counts are that run's, not today's). 1,000 of 1,000 passed, 0 skipped, 0 global errors; verify-bugs: 72 of 72 pins still fail.
- **Live:** [Live site 41808674880](https://github.com/fgacic/qa-lab-playwright/actions/runs/41808674880). 330 passed. The 13 failures come from Cloudflare challenging the runner's requests; the same specs pass from a home connection.
- **History:** all runs are listed in [COVERAGE.md](docs/COVERAGE.md#runs).

## How the CI works

`.github/workflows/ci.yml` runs on every push to `main`, every pull request, nightly at 03:17 UTC, and on demand. It is the gate, against the self-hosted shop.

1. **typecheck.** `tsc --noEmit`.
2. **e2e.** A 9-job matrix:
   - Chromium in 3 shards, Firefox in 2, WebKit in 2, and the `perf` project alone;
   - one job for the real account and admin projects plus the mobile smoke set.

   Each job restores npm and the Playwright browsers from cache, then builds Toolshop with `docker/bake-action` and a GitHub Actions layer cache. The cache means the PHP extensions and the Angular build only rebuild when the pinned commit changes. The job then starts the stack (`scripts/toolshop.sh`), runs its shard, and uploads a blob report and its Allure results.
3. **visual.** Same stack. The screenshots are compared inside `mcr.microsoft.com/playwright:v1.64.1-noble`, the image the baselines were recorded in, so fonts and rendering match.
4. **verify-bugs.** Runs every `@bug` test, in whichever project schedules it, as a plain test. Each must fail for its own reason: the first error names the pin's id, is an assertion, and comes from the spec file. A pin that passes means a defect was fixed; one that fails otherwise broke for another reason (a locator, a timeout, a precondition, a teardown). Either fails the job. The perf pins run in a pass of their own, and the `@live-only` pins are listed as not verifiable on this target.
5. **record-perf-baseline.** Manual only (workflow_dispatch input), not part of the gate. See Performance baselines above.
6. **merge reports.** Downloads every blob and merges them into one HTML report. It then fetches the published Allure `history/history.jsonl`, generates the Allure 3 report (which appends this run to the history), and assembles the site.
7. **gate.** The single required check for branch protection: red when typecheck, e2e, visual or verify-bugs is red, skipped or cancelled.
8. **publish.** From `main` only, with `actions/deploy-pages`, red runs included so the history records them. The history file is published with the report, which is how the Trend, Duration and Retries charts keep growing.

On the self-hosted gate a test that only passed on its retry fails the run (`failOnFlakyTests`): a flake there is a defect in the suite, not noise.

`.github/workflows/live.yml` runs the suite against practicesoftwaretesting.com, as a signal and not a gate. **It is disabled in GitHub Actions for now:** Cloudflare challenges the runners, and the self-hosted gate already runs the commit the public site runs. Re-enable it with `gh workflow enable "Live site"` to check for drift. It runs Chromium and the mobile set, one job at a time, so at most two workers touch the public site. Cloudflare answers part of the runner's navigations with a bot challenge. The suite never tries to get past it: a test whose own navigation is challenged is skipped with that reason, and any other test the challenge interrupts carries a `bot challenge` annotation in the report.

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

- **Silent failures everywhere.** A failed product list, cart (BUG-13, BUG-32), product, rentals, favourites, search or admin list leaves a blank area or a misleading empty state. A rejected order still says "Payment was successful" (BUG-17).
- **Data and validation.**
  - A failed quantity update leaves line and cart totals disagreeing (BUG-14).
  - A future birth date is accepted (BUG-18).
  - Credit Card and Buy Now Pay Later can be checked with nothing filled in (BUG-16, BUG-29).
  - Searches over 40 characters are silently dropped (BUG-27).
  - A full-name search fails when the name has a word under 3 letters (BUG-28).
  - A search under 3 characters is silently ignored (BUG-35), and a spaces-only one is sent and reported as "0 products found" (BUG-34).
  - After a sort or filter change from a later page the list restarts at page 1, but the pager still marks the old page (BUG-33).
  - The registration page promises passwords of at least 8 characters; the validation message says 6 (BUG-31).
  - The price slider shows whichever answer arrives last, so a slow one for an earlier step replaces the final filter (BUG-30). It surfaced as a flaky test under load; holding one answer back reproduces it every time.
- **Back office** (ADM-01..12):
  - Delete never asks for confirmation.
  - A failed reply, a failed message status save and a refused brand or category save (409) are not reported (ADM-10..12).
  - Prices are not validated.
  - The edit form drops stock, brand, category and image, so an existing product cannot be saved as loaded.
- **Sessions.** `/users/refresh` throws an unhandled exception (500), so every session ends after 5 minutes.
- **Raw text leaks:** "[object Object]", "true", `page.forgot-password.confirm` (BUG-20, 21, 22).
- **Untranslated text.** Twenty areas stay English in the other languages (I18N-01..20): the notification bar, the screen-reader heading, the footer, "Sign in with Google", the registration help, the privacy page, the hard-coded "Quantity", the page titles of eight pages, the credit-card form in German, and the labels a screen reader reads out (menus, chat and its close button, cart link and line quantities, sort, slider, pagination, login links, the logo tooltip and the banner's alt text). Some of those labels are internal ids, like "nav-categories", "cart" and "ngx-slider".
- **Accessibility.** 13 axe violations, 6 of them critical:
  - the checkout tabs break the ARIA tab pattern;
  - three password buttons have no name;
  - the language button's name does not match its "EN" label;
  - the related-products links are too small to tap.

  Four more defects were found by locator friction: the cart remove control, Sign out, and pagination that is disabled by CSS only.
- **Security headers.** The live site sends no CSP, X-Frame-Options, nosniff, Referrer-Policy or HSTS, and the API names its server and OS versions (SEC-01..06).
- **Performance.** The footer renders before the page content and jumps (CLS 0.17 to 0.38 on home, product and contact, PERF-01). The cart shifts by 0.107, a hair over the 0.1 budget: that is an observation held to its baseline, not a pin, because a pin that noise can flip cannot tell a fix from luck. LCP, TBT and INP are well inside budget, even at 4× CPU throttling.
- **Test-design lessons.**
  - `test.use()` reads a two-element array as `[value, options]`, so mocks are an object.
  - Fixture-driven navigation needs settle waits, or a late initial response overwrites the test's first search.
  - Laravel caches product lists across a reseed.
  - The pinned tag 2.5 differs from what the live site runs, hence building from a commit.
  - Six chat "contrast" findings were the scan catching a fade-in. Scan settled states only.
- **What a review of the suite itself found** (`/pw-review`, then fixed):
  - Five known-bug pins would have stayed green after their bug was fixed: their first assertion only held while the bug existed, so a fix turned them into a timeout, which `test.fail` accepts. Pins now assert the right behaviour first, and verify-bugs checks each fails for its own reason.
  - A describe-level mock sequence was used up by the first test in a worker, so the second got the wrong answer. Retries hid it.
  - "Nothing is shown" checks passed before the data arrived; they now wait for the response that feeds the page.
  - The XSS sentinel only noticed `alert()`; script that ran quietly went unseen, and nothing proved the sentinel worked.
  - Budgets on one unthrottled sample, next to other workers, could pass on a measurement of zero.
  - A performance baseline recorded on a busy laptop is meaningless on the CI runner, so it is now recorded per environment, and enforced only where one exists.

## What I would change

- **Run axe on Firefox and WebKit too, each with its own baseline.** Today it runs on Chromium only, because the engines disagree in edge cases.
- **Contract-check the mocks.** The payloads mirror the OpenAPI document by hand. A job validating them against the spec would catch drift before mocked tests start lying.
- **Re-enable the live run** on a runner Cloudflare does not challenge, and publish it next to the gate's report, for example under `/live`, with its own Allure history.
- **Let Renovate** bump the pinned action SHAs, base images and the Toolshop commit, each through its own pull request run.

---
Tools: Playwright, TypeScript, GitHub Actions, Allure · Part of the [qa-lab](https://github.com/fgacic?tab=repositories&q=topic:qa-lab) series.
