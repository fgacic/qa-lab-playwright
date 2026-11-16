# Playwright UI suite

End-to-end UI tests for the Toolshop demo shop (practicesoftwaretesting.com), run in GitHub Actions against a self-hosted copy of the shop, with an Allure report on GitHub Pages.

**Live report: [fgacic.github.io/qa-lab-playwright](https://fgacic.github.io/qa-lab-playwright/)**, with Allure trends across runs. The Playwright HTML report is under [/playwright](https://fgacic.github.io/qa-lab-playwright/playwright/).

The suite runs **1,452 tests in Chromium and 622 each in Firefox and WebKit** (the axe, keyboard, translation and API suites are Chromium-only), in 67 spec files (and 17 more for the framework). On top of that come:

- 19 performance tests, measured alone in a project of their own, with no retries: 16 measurements (five pages, two phone loads, the page weight of two pages, and the layout shifts) and the three controls that prove the collector sees a long task, a slow click and a known document;
- an 18-test smoke set on a Pixel 7;
- 30 visual baselines (31 tests: one more checks that no baseline on disk is orphaned);
- 29 tests in the real-account and real-admin projects: 27 journeys and the 2 sign-ins they start from;
- 179 framework tests (no site involved, bar the few that start a nested run): the mock layer, the target configuration, the write guard and its teardown check, the answer gate that holds a request open for the double-click pins, the console guard (its allowance for a logged failed request, in the shape of each engine), the run guard, the lint configuration (each banned pattern has a sample that must be refused and one that must not), the preflight and the health check, the Toolshop API helpers, the a11y ratchet's decision (`diffFindings`) and its refusal to record on CI, the performance baseline arithmetic, the `test-all` runner, the security header matchers (run offline on sample values), the verdicts and the orchestration of verify-bugs (every engine a pin is scheduled in, a rerun of a pin that passes, the per-project shards), and a check that every defect id in the code is in COVERAGE and the reverse.

Every control the site exposes, the back office included, is listed in [docs/COVERAGE.md](docs/COVERAGE.md) with the test that covers it.

The suite found **156 defects**, each pinned as a test. (157 ids are in use: I18N-23, the forgot-password confirmation that shows its raw key, is BUG-20 seen from the translation suite. Both stay as pins, because they test different surfaces, but the defect is counted once, under Functional.)

| Kind | Count |
|---|---|
| Functional | 90 (BUG-01..38, BUG-40..65 and BUG-68, ADM-01..25: 25 of them in the back office) |
| Accessibility | 19 (A11Y-01..04, AX-01..13; AX-14 is a focus defect found by the keyboard checks, AX-15 a page that scrolls sideways on a 320 px screen) |
| Translation | 29 (I18N-01..30 without I18N-23; I18N-27 is a key the English file lacks, I18N-28 a placeholder the Greek file drops, both found by comparing the translation files; I18N-29 and I18N-30 are the amounts and the order date, which ignore the language) |
| Security | 17 (SEC-01..06 headers on the live site; SEC-07..09 unauthenticated writes to the catalogue API; SEC-10..12 an order or message status set by a customer, and a favourite "deleted" by another customer that answers 204; SEC-13 an uncaught error on an unknown category route; SEC-14 the token of a deleted account that is still accepted; SEC-15 a customer's cart that answers anybody with its id; SEC-16 an admin account that never locks; SEC-17 no rate limit on sign-in) |
| Performance | 1 |

BUG-39, BUG-66 and BUG-67 were never assigned.

## What it tests

| Area | Specs | Highlights |
|---|---|---|
| Shop | `tests/navigation`, `catalog`, `product`, `cart`, `checkout`, `contact`, `widgets` | Every header link lands where it says; search, sort, filters (and their combinations with search and sort), pagination, compare; cart maths and discounts, re-checked after a reload; **full guest purchases** with Cash on Delivery; chat and the live sales feed |
| Accounts | `tests/auth`, `tests/account` | Login (incl. TOTP and a wrong code), registration, password reset (the refused-login and unknown-email answers are real on the self-hosted shop, with mocked twins elsewhere); **register → log in → account** for real on the self-hosted shop, mocked everywhere else |
| Back office | `tests/admin`, `tests/admin-e2e` | Every admin list, form, status change, report and setting against a mocked admin API; **real journeys** as the seeded admin (self-hosted): create → list in the shop → reprice → delete a product, ship an order, read, take in progress and answer a message; every address of the back office turns away a customer and an anonymous visitor (21 of them, mocked), and an expired session (401) on the dashboard, the reports and a form save is pinned |
| Failure paths | every area | Each request the UI sends also answers 500, 4xx, a network abort, and an empty 200; the back office reports a failed reply, status save or refused save, or the test pins that it does not; a healthy page is shown to raise no alert, proven over a time window |
| Accessibility | `tests/a11y` | axe-core WCAG 2.2 A/AA on 55 pages and states (the empty cart and comparison, the forgot-password confirmation and the profile with errors among them, and the cart, login and billing at phone width), plus keyboard checks axe cannot make (Tab order, a visible focus indicator, menus that take the keyboard in and give it back) (the cart, the checkout sign-in step and the account menu among them; three of them at phone width, 320 px, with reduced motion; the language menu, the add-to-cart toast, the compare bar, the mobile menu, the order confirmation and the admin delete confirmation among them); five pages at 200% zoom (640 px: no sideways scrolling) and with the text spacing of WCAG 1.4.12 (no box cuts its text); 13 known violations pinned one by one (every baseline id has a pin), and the baseline is a ratchet on rule, element, page, count and impact: a fix, a spread or a change of impact all fail until it is updated; every scan waits for its page to be ready and its fonts loaded first, the ratchet's decision is one pure function (`diffFindings`) that the framework tests table-test, and each exclusion (the training aids) has a test that it still matches something |
| Visual | `tests/visual` | 30 screenshots of key pages and states (out-of-stock product, checkout payment, admin orders and an order, phone-width shots of the home page and the cart, an empty catalogue, the empty cart and the guest checkout errors, the German home page, the open language menu, a hovered button and a focused field among them; English apart from the German home page; the rentals shot is answered with the seeded rentals only, so the temporary rentals other specs make cannot change it), compared in the official Playwright image (pinned by digest, run as amd64). The price (a product's and the first card's), the out-of-stock label and the cart total are compared with a 0 px budget and a colour threshold of 0, because a full-page budget of 150 px would miss a changed price digit (proven by a mutation) |
| Translations | `tests/i18n` | 32 pages and states in all 7 languages (the home page on a phone among them; search without results, comparison with products, the order confirmation, a refused login, the forgot-password confirmation, 5 signed-in account pages and 3 account lists with records among them): visible text, `<title>`, labels, placeholders, alt text, `aria-description`, `aria-valuetext`, `aria-placeholder` and options, the product card included except its name, price and image. No leaked keys (only real data is skipped), no stray English, with a positive control that the scan sees a missing key; the seven translation files are also compared with each other (I18N-27), and a plain test fails on any drift beyond the known I18N-27 and I18N-28 entries; amounts and order dates are checked against each language's own number and date format (I18N-29, I18N-30); each known untranslated item is pinned once per language it affects (219 tests across 26 ids) |
| Security | `tests/security` | Script and HTML payloads through search, chat, contact, registration, admin forms and route segments (`/category/<payload>`, `/product/<payload>`) are shown as text, never run, watched by a sentinel that is itself tested (popups and other tabs included, with a control for every payload), which watches a 1 s window, so a pass says "nothing ran inside the window", not "nothing can ever run"; a product name carrying an attribute payload (a focus handler, a `srcdoc`, a `javascript:` URL, an entity-encoded quote) is shown as text in the picture's attribute too; live response headers by value, cookie flags, CORS with credentials and Permissions-Policy; **API authorisation** on the self-hosted shop, once, in Chromium (401 without a token, 403 for a customer on admin endpoints, another customer's invoice, account and profile refused, a customer's cart (answered to anybody with its id, SEC-15) and the ids of carts (unissued ids are 404, ids are random), a customer account that locks after 3 wrong passwords, an admin account that never locks and no rate limit on sign-in (SEC-16, SEC-17), the token of a deleted account on all five calls a customer makes (SEC-14), their favourites kept, catalogue writes and deletes refused, forged tokens refused (a changed signature, `alg: none`, a customer's token promoted to admin), a customer's lists holding only their own rows, a customer unable to make themselves an admin through the profile, every write read back as the admin, with controls that the admin may do the same) |
| Performance | `tests/performance` | LCP, TBT (long tasks before the first input) and an INP proxy per key page against Core Web Vitals limits and against a baseline recorded per environment (`ci`, or `local` keyed by CPU model and cores), the median of 5 throttled cold loads, on the desktop and, for home and a product, on a Pixel 7 screen; the page weight of home and a product (bytes, requests, script bytes) against fixed ceilings (home 1.8 MB, 50 requests, 1.15 MB of scripts; product 1.7 MB, 44, 1.15 MB); a control proves the long-task observer counts a known 150 ms task, a second that the INP proxy reports a known slow click, and a check that the page received an input at all; CLS on a slow API (the cart held to a fixed 0.13 ceiling as well as its baseline; the PERF-01 pages also ratcheted by tests of their own wherever their shift is steady enough to record) |

Tags pick subsets: `@smoke`, `@negative`, `@mocked`, `@flow`, `@bug`, `@a11y`, `@axe`, `@visual`, `@i18n`, `@security`, `@perf`, `@mobile`, `@account`, `@admin`.

Tags also decide where a spec is scheduled, in `playwright.config.ts`, so nothing is skipped at run time:
- `@axe`, `@i18n` and `@api` run on Chromium only, `@perf` in its own one-worker `perf` project, and `@framework` (the suite's own self-tests) in the `framework` project;
- `@mobile` runs only on the phone project;
- `@self-hosted` never runs on live, and `@live-only` runs only there.

Guards in the framework, so a run cannot quietly prove nothing:
- An unknown `TARGET` throws, and `TARGET=local` with a non-local `BASE_URL` / `API_URL`, or with two different origins for them, throws.
- `knownBug` requires the `@bug` tag, and verify-bugs matches pin ids as whole words (`BUG-1` is not found in `BUG-12`). It also rejects a reproduction whose locator matched no element ("element(s) not found"), unless the pin opts in with `knownBug(id, summary, { absence: true })` because the defect is itself a missing element or message, and it reruns the "failed for another reason" pins once before failing. A pin that depends on timing (a double click, a repeated submit) holds the request open until the clicks have landed (`holdAnswers`, `src/support/answer-gate.ts`: the pattern of BUG-46, BUG-53 and BUG-59), so its reproduction does not depend on speed or on the engine. verify-bugs runs a pin in every engine that schedules it, and a pin that passes is rerun alone before it is called fixed, so a race that was lost once (it is how a flaky BUG-46 reached the gate) is reported as flaky, not as a fix.
- A negative is proven one way: `ApiMock.expectNoRequest(method, path, { within })` watches a window for a request that must not happen. Routes are installed on the browser context, so popups and other tabs are covered.
- The run guard counts final outcomes only, so a retried pass is not counted twice.
- A run that schedules `perf` next to another project is refused (`src/support/run-guard-reporter.ts`).
- On live, a run fails if more than 20% of its tests were skipped for the bot challenge.
- Every page test asserts at teardown that `apiMock.blockedWrites` is empty: a write no mock answers is refused, and fails the test. The write guard is on by default for the live target; anonymous cart writes (add to cart, cart edits) are allowed there as arrange steps.
- `apiMock` is not an auto fixture: a test that mocks says so.
- **Console guard.** Every test fails if its browser logged a `console.error` or threw an uncaught error that is not allowed (`fixtures/console-guard.ts`, the lists in `src/support/console-guard.ts`). An error is matched on its text and on the arguments the page passed (`consoleArgsText`), because the engines print an object differently. Allowed suite-wide, each with its reason: the logs of the defects that have a pin of their own (BUG-02, BUG-37, BUG-38, BUG-47, BUG-54, SEC-13, ADM-21), each only on the route of the page that raises it, so the same error on another page still fails; the "Unauthorized" of the anonymous `GET /users/me`, only in a test whose browser received that 401 (read from the response, so it is the same in every engine); the 404 and 500 for an unknown product id on the product page; and the browser's "Failed to load resource" only for the statuses the suite expects (401, 404, 409, 422) or an answer the test's own mocks gave. A real 5xx or a refused connection fails the test. A test that provokes an error on purpose (a mocked failure the app logs) declares it with `consoleGuard.allow(pattern, reason)`, recorded as an annotation; the line the SPA logs for a mocked failed request has its own helper (`allowLoggedFailure`), which reads the line in each engine's shape (Firefox prints it as `ERROR Error` or `ERROR JSHandle@object`, so the arguments are read) and allows it only in a test in which a request really failed (an answer of 400 or more, or an aborted request).
- **Slim tests for specs with no page.** `apiOnlyTest` (`fixtures/index.ts`) merges only the API client, the admin token and the report labels, so the `@api` and header specs open no browser context; the auto fixtures that need a `page` are not part of it.
- **Preflight and early stop.** A `globalSetup` check (`src/support/preflight.ts`) refuses to start against a target that is not answering, with one message instead of hundreds of timeouts, and on CI the run stops after 30 failures (`maxFailures`), except `npm run test:verify-bugs`, which passes `--max-failures=0`: a verify run is meant to see every pin fail.
- The self-hosted test timeout is 45 s, so a hung test fails early; live gets 90 s.


Static checks: `npm run lint` (ESLint with `eslint-plugin-playwright`, zero warnings allowed) runs next to `tsc --noEmit`, locally and in CI. A spec may not run code in the page (`evaluate`, `evaluateAll`, `evaluateHandle`, `$eval`, `$$eval` and `waitForFunction`, on any receiver: a page, a locator, a frame or a handle), nor read the clock (`Date.now()`, `new Date()`, `performance.now()`) or `Math.random()`: it uses a named helper (`storedToken`, `fetchStatus`, `consoleArgsText`, `elapsedMs`) or a fixed value. The workflow linter (actionlint) runs from an image pinned by digest.

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

Requires Node 22 (`.nvmrc`, `engines.node` `>=22 <23`) and Docker. The Toolshop container binds to 127.0.0.1 only.

```bash
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run toolshop:up                  # build, start, seed and health-check the shop

npm run lint                         # ESLint, 0 warnings
npm test                             # everything against the self-hosted shop, in four passes (scripts/test-all.mjs, a separate report for each), as in CI:
                                     # the browsers; the framework self-tests; perf alone, so nothing competes for the CPU it measures;
                                     # then the real sessions, because a Toolshop token lives 300 s and cannot be renewed
npm run test:parallel                # the browsers pass only, with more workers; self-hosted shop only (TARGET=local)
npx playwright test --project=webkit # one browser
npm run test:smoke | test:a11y | test:i18n | test:security | test:perf
npm run test:account                 # real customer journeys (setup project signs in)
npm run test:admin                   # real back-office journeys as the seeded admin
npm run test:visual                  # screenshots, inside mcr.microsoft.com/playwright:v1.64.1-noble
npm run test:visual:update           # re-record the baselines in that image, then commit them
npm run test:verify-bugs             # every pinned defect must still fail in every engine that runs it, each for its own reason
npm run test:verify-bugs -- --project=firefox   # one project only (--skip-project=<name> leaves one out): how CI shards it
UPDATE_PERF_BASELINE=1 npm run test:perf   # re-record this machine's `local` performance baseline (idle machine, load average under 4)
npm run toolshop:reseed              # fresh data between local runs
npm run toolshop:down
npm run report                       # Allure 3 report from allure-results/
```

**Performance baselines.** `tests/performance/baseline.json` holds one set of medians per environment: `ci` when `CI` is set, otherwise `local`. `local` is keyed by a hash of the CPU model and core count, so another machine has no baseline until it records its own. Each metric is the median of 5 loads and is recorded with its spread; a run enforces the median plus a margin of the largest of 3 times that spread, 5% and a per-metric noise floor (the margin, worked out by `ratchetLimits`, is capped at 2 times the noise floor, so one wild recording cannot make the limit meaningless), but only when an entry for its environment exists. Without one it attaches the measured medians and says so (on CI also as a workflow warning), and the absolute Core Web Vitals budgets still apply. Every measurement also has a fixed ceiling (LCP, TBT, INP proxy, CLS) that holds without any baseline, so CI is meaningful before its own baseline exists (the time ceilings are multiplied by 1.5 on CI until a `ci` baseline is recorded, and never above the budget; the current ones are LCP 1600 to 1950 ms, TBT 100 ms, INP 80 ms, which is 2.5 times the highest recorded median, and CLS 0.31, 0.38, 0.21 and 0.13). A metric too noisy to ratchet is not written to the baseline (the run says so, and only its fixed ceiling and the budget hold it): every INP spread is, so INP is held by its ceiling and the budget only, and there is no INP ratchet. TBT counts long tasks from First Contentful Paint to the first input. Recording is refused when the one-minute load average was above 4 as the run began (or the platform reports none), from more than one worker, and from a run that failed, a failure of the console guard or the write guard included. `CI=false` or `CI=0` is not CI. To record the `ci` set, run the CI workflow by hand (Actions, "Run workflow") with **record_perf_baseline** ticked. The `record-perf-baseline` job measures on a runner and uploads `baseline.json` as the `perf-baseline-ci` artifact. Merging it is a human step: download the artifact, review the diff, and commit the file.

**The public site:** `npm run test:live` (`TARGET=live`). There, real-account and admin journeys stay off unless `RUN_ACCOUNT_TESTS=1` / `RUN_ADMIN_TESTS=1` (with `ADMIN_EMAIL`, `ADMIN_PASSWORD`), and payload, visual and performance specs never run. `BASE_URL` / `API_URL` point either target elsewhere.

## Latest runs

- **Gate:** [CI 41812346305](https://github.com/fgacic/qa-lab-playwright/actions/runs/41812346305), report #7, the last published run, from before the second review round (its counts are that run's, not today's). 1,000 of 1,000 passed, 0 skipped, 0 global errors; verify-bugs: 72 of 72 pins still fail.
- **Live:** [Live site 41808674880](https://github.com/fgacic/qa-lab-playwright/actions/runs/41808674880). 330 passed. The 13 failures come from Cloudflare challenging the runner's requests; the same specs pass from a home connection.
- **History:** all runs are listed in [COVERAGE.md](docs/COVERAGE.md#runs).

## How the CI works

`.github/workflows/ci.yml` runs on every push to `main`, every pull request, nightly at 03:17 UTC, and on demand. It is the gate, against the self-hosted shop.

1. **static.** `tsc --noEmit`, `npm run lint`, and the check that the visual image matches `@playwright/test`. Dependencies are installed with `npm ci --ignore-scripts` (no package in the lockfile has an install script).
2. **e2e.** An 11-job matrix:
   - Chromium in 3 shards, Firefox in 2, WebKit in 2, and the `perf` project alone;
   - the `sessions` job for the real account and admin projects, a `mobile` job for the Pixel 7 smoke set, and a `framework` job for the suite's own self-tests.

   Each job restores npm and the Playwright browsers from cache, then builds Toolshop with `docker/bake-action` and a GitHub Actions layer cache. The cache means the PHP extensions and the Angular build only rebuild when the pinned commit changes. The job then starts the stack (`scripts/toolshop.sh`), runs its shard, and uploads a blob report and its Allure results.
3. **visual.** Same stack. The screenshots are compared inside `mcr.microsoft.com/playwright:v1.64.1-noble`, the image the baselines were recorded in, so fonts and rendering match.
4. **verify-bugs.** Runs every `@bug` test, in every project that schedules it, as a plain test, in four shards (Chromium, Firefox, WebKit and the other projects, by `--project` and `--skip-project`), so no single job carries all 636 runs (24 minutes on a laptop; a shared runner is slower, and the single job it replaces had 20). Each must fail for its own reason: the first error names the pin's id, is an assertion, and comes from the spec file. A pin that passes means a defect was fixed; one that fails otherwise broke for another reason (a locator, a timeout, a precondition, a teardown). Either fails the job, and a pin that passes is rerun before it is called fixed. The perf pins run in a pass of their own, and the `@live-only` pins are listed as not verifiable on this target.
5. **record-perf-baseline.** Manual only (workflow_dispatch input), not part of the gate. See Performance baselines above.
6. **merge reports.** Downloads every blob and merges them into one HTML report. It then fetches the published Allure `history/history.jsonl`, generates the Allure 3 report (which appends this run to the history), and assembles the site.
7. **gate.** The single required check for branch protection: red when static, e2e, visual or any verify-bugs shard is red, skipped or cancelled.
8. **publish.** From `main` only, with `actions/deploy-pages`, red runs included so the history records them. The history file is published with the report, which is how the Trend, Duration and Retries charts keep growing.

On the self-hosted gate a test that only passed on its retry fails the run (`failOnFlakyTests`): a flake there is a defect in the suite, not noise.

`.github/workflows/live.yml` runs the suite against practicesoftwaretesting.com, as a signal and not a gate. **It is disabled in GitHub Actions for now:** Cloudflare challenges the runners, and the self-hosted gate already runs the commit the public site runs. Re-enable it with `gh workflow enable "Live site"` to check for drift. It runs Chromium and the mobile set, one job at a time, so at most two workers touch the public site. Cloudflare answers part of the runner's navigations with a bot challenge. The suite never tries to get past it: a test whose own navigation is challenged is skipped with that reason, and any other test the challenge interrupts carries a `bot challenge` annotation in the report.

The rest of the setup:

- **Actions** are pinned to commit SHAs, and Dependabot proposes weekly updates for them and for the npm dev dependencies (`.github/dependabot.yml`).
- **Concurrency** cancels superseded pull-request runs, Pages deploys are serialised, and the nightly run has a concurrency group of its own. Checkouts do not persist credentials, the Pages deploy has a timeout, and the fetched Allure history is validated before it is used.
- **No secrets.** None is needed: the only accounts used are the self-hosted shop's seeded test accounts.

## Structure

```
docker/, docker-compose.yml, .env.toolshop   the self-hosted Toolshop, pinned
src/components/   Header, FilterPanel, ProductGrid, CartTable, checkout steps, admin table and search, FormField…
src/pages/        thin pages composing components; actions return the next page
src/support/      env (targets), @step, ApiMock, ToolshopApi, payloads, test data, seeded accounts (JSON), knownBug, the answer gate (`holdAnswers`), the console guard, i18n and its baseline, a11y baseline, the seeded catalogue's terms, the security-header matchers, the authorisation helpers (`authz`), the page-weight counter, a frozen clock, a failing asset (`failAsset`), admin payloads and `admin-deletable`
fixtures/         api · mocks · pages · auth · admin (and `admin-cleanup`, the fixtures that delete what a back-office test made) · a11y · security · performance · matchers → index.ts (mergeTests, mergeExpects)
tests/            specs by area; tests/setup/* sign in and write storageState
docs/COVERAGE.md  every control, its test, the bug list, and run results
```

- **Fixtures inject page objects.** Tests destructure `{ homePage, productPage, checkout }`. The fixture does the setup (a seeded cart, a comparison, a session, mocks) and opens the page; no test calls `new`. Options change the setup per describe block, for example `test.use({ productKind: 'out-of-stock' })`, `test.use(withMocks(mock.fail('QUERY', '/products')))` or `test.use({ apiLatencyMs: 500 })`.
- **Composition, not inheritance.** No BasePage. Components take a root `Locator`. Pages hold an `AppShell`, and admin forms an `AdminFormChrome`.
- **User-facing locators.** `getByRole` and `getByLabel` first. `getByTestId` (`data-test`) only where no role or label is unique: error labels, the cart badge, and buttons whose names change with the language. CSS only where the markup leaves no other handle, each case commented.
- **Methods say what the user does.** Examples are `filters.filterByCategory('Pliers')` and `checkout.payment.payOnDelivery()`. Each is wrapped in `test.step` by a `@step` decorator.
- **Sessions.** `mocked` (fake JWT) runs everywhere. `storage-state` comes from a setup project. `worker-account` gives each worker its own customer, shared by the tests of that worker: only tests that read it or add something they find again by a unique key use it, and a test that changes the account (favourites, the profile, a password) takes `newAccount`, a customer registered for that test alone. Toolshop's JWT lives 300 s and the suite does not use the refresh endpoint, so real sessions get a fresh token per test.

## What broke

Everything is listed in [docs/COVERAGE.md](docs/COVERAGE.md#bugs-found). The headlines:

- **Silent failures everywhere.** A failed product list, cart (BUG-13, BUG-32), product, related products (BUG-43; an unknown product's related products answer 500, BUG-62), rentals, a translation file (BUG-63), favourites, search or admin list leaves a blank area or a misleading empty state. A rejected order still says "Payment was successful" (BUG-17).
- **Data and validation.**
  - A failed quantity update leaves line and cart totals disagreeing (BUG-14).
  - A future birth date is accepted (BUG-18).
  - Credit Card and Buy Now Pay Later can be checked with nothing filled in (BUG-16, BUG-29).
  - Searches over 40 characters are silently dropped (BUG-27).
  - A full-name search fails when the name has a word under 3 letters (BUG-28).
  - A search under 3 characters is silently ignored (BUG-35), and a spaces-only one is sent and reported as "0 products found" (BUG-34).
  - After a sort or filter change from a later page the list restarts at page 1, but the pager still marks the old page (BUG-33).
  - The registration page promises passwords of at least 8 characters; the validation message says 6 (BUG-31).
  - The price slider shows whichever answer arrives last, so a slow one for an earlier step replaces the final filter (BUG-30). It surfaced as a flaky test under load; holding one answer back reproduces it every time. The billing address has the same race: an older lookup answer overwrites the address of the last house number (BUG-41).
  - A malformed postcode is explained, yet Proceed stays enabled (BUG-40).
  - The API refuses a cart quantity of 2.5 (422), but the line keeps 2.5 and its total (BUG-42).
  - An out-of-stock product can sit in the cart, priced as normal, with no notice, while Proceed stays enabled (BUG-44).
  - On a completely filled registration form, Enter in the password field answers "Password is required" and registers nobody; Enter in the email field works (BUG-36).
- **Back office** (ADM-01..23):
  - Delete never asks for confirmation.
  - A failed reply, a failed message status save and a refused brand or category save (409) are not reported (ADM-10..12), and neither is an edit of a brand or category the API refuses (ADM-23).
  - Prices are not validated.
  - The edit form drops stock, brand, category and image, so an existing product cannot be saved as loaded.
  - A failed order load says "This invoice doesn't exist." (ADM-13); an edit form whose record fails to load (product, brand, category, user, message) opens empty (ADM-14); failed statistics show empty tables (ADM-15); a failed list search leaves the old table (ADM-18); a specification that cannot be removed stays without a word (ADM-19); the form cannot create a user against the real API (ADM-20); a refused session (401) on a list leaves the admin on an empty table instead of the sign-in page (ADM-22), and a created user throws an Angular error (ADM-21).
  - Settings accept a non-URL payment endpoint and report "Settings saved!" (ADM-16), and the user form's password field is plain text (ADM-17).
- **Sessions.** A refused token (401) on an account call sends the SPA to a login address that is not a route and leaves the stale token and the account menu (BUG-56, BUG-57), and the token of a deleted account is still accepted by the API (SEC-14). `GET /users/refresh` throws an unhandled exception (500) when it gets no valid token, so every signed-out visit of a protected page logs a server error (BUG-54). A valid token is refreshed.
- **Forms and lists.** The contact form sends a message of only spaces (BUG-58) and a double-click on Send posts it twice (BUG-59); the comparison calls a rental "Out of Stock" (BUG-60); the later pages of a search drop the rentals the first page counted (BUG-61).
- **Raw text leaks:** "[object Object]", "true", `page.forgot-password.confirm` (BUG-20, 21, 22; the last is also I18N-23, counted once).
- **Untranslated text.** Twenty-five areas stay English in the other languages (I18N-01..26, with I18N-23 counted under BUG-20), and the Greek file drops a placeholder (I18N-28): the notification bar, the screen-reader heading, the footer, "Sign in with Google", the registration help, the privacy page, the hard-coded "Quantity", the page titles of eight pages and of the account pages (13 pins, one per title), the search caption, the raw `NEW` status badge on the account messages list, the refused login's error, the credit-card form in German, and the labels a screen reader reads out (menus, chat and its close button, cart link and line quantities, sort, slider, pagination, login links, the logo tooltip, the banner's alt text and the phone menu toggler). Some of those labels are internal ids, like "nav-categories", "cart" and "ngx-slider".
- **Accessibility.** 13 axe violations, 6 of them critical (and the cart table that makes a 320 px screen scroll sideways, AX-15, which axe has no rule for):
  - the checkout tabs break the ARIA tab pattern;
  - three password buttons have no name;
  - the language button's name does not match its "EN" label;
  - the related-products links are too small to tap.

  Four more defects were found by locator friction: the cart remove control, Sign out, and pagination that is disabled by CSS only. The scans also run at phone width, where AX-13 shows again.
- **Found by the console guard.** Pages that look fine while the app throws behind them: the profile page's QR code widget logs an error on every visit (BUG-37), the checkout throws while it reads a cart that is not there (BUG-38), and the category page throws for a slug it does not know (SEC-13). Changing the password throws in the page on every answer (BUG-47). The chat window does not close on Escape (BUG-45), and a double click on Confirm places two orders (BUG-46).
- **Security.** The live site sends no CSP, X-Frame-Options, nosniff, Referrer-Policy or HSTS, and the API names its server and OS versions (SEC-01..06). On the self-hosted shop, the brand, category and product write APIs accept anonymous callers and customer tokens, for both create and update (SEC-07..09); reads and deletes are refused. Any customer can also set an order's or a message's status (`PUT /invoices/{id}/status`, `PUT /messages/{id}/status`, SEC-10, SEC-11), and another customer's `DELETE /favorites/{id}` answers 204 though nothing is deleted (SEC-12).
- **Performance.** The footer renders before the page content and jumps (CLS 0.17 to 0.38 on home, product and contact, PERF-01). The cart shifts by 0.107, a hair over the 0.1 budget: that is an observation held to a fixed 0.13 ceiling and to its baseline, not a pin, because a pin that noise can flip cannot tell a fix from luck. LCP, TBT and INP are well inside budget, even at 4× CPU throttling.
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
- **Bump the base images and the Toolshop commit the same way.** Dependabot already covers the action SHAs and the npm dev dependencies; the Docker images and the pinned Toolshop commit are still manual.

---
Tools: Playwright, TypeScript, GitHub Actions, Allure · Part of the [qa-lab](https://github.com/fgacic?tab=repositories&q=topic:qa-lab) series.
