# Playwright UI suite

End-to-end UI tests for the Toolshop demo shop (practicesoftwaretesting.com), run in GitHub Actions with an Allure report on GitHub Pages.

The suite has **338 tests per desktop browser** (on Firefox the 51 axe tests skip, because the baseline is kept for Chromium), plus a 14-test smoke set on a Pixel 7 viewport. Ten more tests are gated real-account and real-admin journeys. Every control the site exposes, the back office included, is listed in [docs/COVERAGE.md](docs/COVERAGE.md) with the test that covers it. **34 functional defects (8 of them in the back office) and 23 accessibility defects** are pinned as tests.

## What it tests

| Area | Specs | Highlights |
|---|---|---|
| Navigation | `tests/navigation` | Logo and every header link land where they say, 7 languages, protected routes redirect, banners, footer, mobile menu |
| Catalogue | `tests/catalog` | Search, 6 sort orders, category / brand / eco / price filters, pagination, category pages, rentals, comparison |
| Product | `tests/product` | Details against the API, quantity rules (0 → 1, > 99 → 99), add to cart, favourites, out-of-stock, related |
| Cart | `tests/cart` | Line and total maths, edit, remove, 5 % eco and 15 % combination discounts |
| Checkout | `tests/checkout` | Sign-in / guest step, billing with postcode lookup, all 5 payment methods, **two full guest purchases** |
| Auth | `tests/auth` | Login (incl. TOTP), registration (12 fields), password reset, **register → login → account** (mocked auth) |
| Account | `tests/account` | Favorites, invoices, messages, profile, sign-out (mocked session); real-account journeys (gated) |
| Contact, widgets | `tests/contact`, `tests/widgets` | Contact form and attachment rules, chat assistant incl. support ticket, live sales feed (mocked SSE) |
| Back office | `tests/admin`, `tests/admin-live` | Every admin list, form, status change, report and setting against a **mocked** admin API; real journeys (create → sell → reprice → delete a product, ship an order, answer a message) gated |
| Accessibility | `tests/a11y` | axe-core WCAG 2.2 A/AA scan of 32 pages and states incl. account and back office; 19 known violations pinned one by one |

Tags pick subsets: `@smoke`, `@negative`, `@mocked`, `@flow`, `@bug`, `@a11y`, `@mobile`, `@account`, `@admin`.

## Why these cases

- **One rule per feature: positive, negative, failing API, empty API.** Every request the UI sends has a twin test with `page.route` answering 500, 4xx or a network abort, and one answering an empty 200 in the real shape. That is where most bugs were: the shop handles the happy path and often goes silent on errors.
- **The UI is checked against the API, not against hard-coded data.** The demo data is shared and drifts (stock flips, other users add categories). A filter test asserts three things: the request carries the filter, the API's answer honours it, and the grid shows exactly that answer.
- **Arrange through the API, act through the UI.** Carts are created with `POST /carts` before a cart test, and products are looked up at runtime (in stock, out of stock, eco, rental). A test only clicks through what it is about.
- **Known bugs are tests, not notes.** `knownBug('BUG-14', …)` wraps `test.fail`. The spec states the correct behaviour, today's failure is expected, and the test goes red the day the site is fixed. `npm run test:verify-bugs` runs them as ordinary tests, to prove each fails at its final assertion and not earlier.
- **The back office is tested in two layers, and the README says which proves what.** Mocked admin specs (fake admin JWT, every endpoint answered from the OpenAPI shapes) prove the UI's behaviour on given responses. A guard refuses any write no mock answers, so they can never touch the shared backend. Real admin journeys exist but are gated, because they change data on a public shop.
- **Accessibility runs on a baseline.** A scan fails on any violation that is not already known, which catches regressions. Every known violation has its own pin, which catches fixes. Results are attached per scan.
- **Safe on a public site.** No real accounts and no real sign-ins in normal runs. No card, bank or gift-card numbers are ever typed, not even fake ones. Orders use Cash on Delivery with `example.com` guests. At most 2 workers.

## How to run

```bash
npm ci
npx playwright install chromium firefox   # if the browsers are not cached yet

npm test                      # everything; the account project skips itself
npm run test:chromium         # one browser
npm run test:smoke            # @smoke only (also what the mobile project runs)
npx playwright test --grep @mocked
npm run test:verify-bugs      # known-bug specs as plain tests: all should fail
npm run test:a11y             # axe scans and the known-violation pins (Chromium)
npm run report:html           # last HTML report
npm run report                # Allure report from allure-results/
```

`BASE_URL` and `API_URL` point the suite at another deployment of Toolshop.

**Real-account specs** register a customer, sign in for real and place a signed-in order. They are skipped unless you opt in:

```bash
RUN_ACCOUNT_TESTS=1 npm run test:account
# optional: use an existing account instead of registering one
TOOLSHOP_EMAIL=… TOOLSHOP_PASSWORD=… RUN_ACCOUNT_TESTS=1 npm run test:account
```

**Real admin journeys** need an admin account and change data on the shop (each test cleans up what it creates):

```bash
RUN_ADMIN_TESTS=1 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:admin
```

**CI** (`.github/workflows/ci.yml`) runs on every push and PR. It type-checks, runs Chromium, Firefox and mobile in parallel jobs, and uploads each HTML report. On `main` it merges the Allure results and publishes them to GitHub Pages (Settings → Pages → Source: *GitHub Actions*).

## Structure

```
src/components/   Header, FilterPanel, ProductGrid, CartTable, checkout steps, FormField, Toast…
src/pages/        thin pages that compose components; actions return the next page
src/support/      @step decorator, ApiMock, ToolshopApi, payloads, fake test data, knownBug
fixtures/         api.ts · mocks.ts · pages.ts · auth.ts · matchers.ts → index.ts (mergeTests, mergeExpects)
tests/            specs by area; tests/setup/account.setup.ts writes storageState (gated)
docs/COVERAGE.md  every control, its test, and the bug list
```

- **Fixtures inject page objects.** Tests destructure `{ homePage, productPage, checkout }`. The fixture does the setup (seed a cart, a comparison, a session) and opens the page, so no test calls `new`. A describe block changes the setup with `test.use({ cartItems })`, `test.use({ productKind: 'out-of-stock' })` or `test.use(withMocks(mock.fail('QUERY', '/products')))`.
- **Composition, not inheritance.** No BasePage. Components take a root `Locator` and scope everything inside it. Pages hold an `AppShell` (header, footer, toasts, widgets) plus their own components.
- **Locators are readonly properties, user-facing first.** `getByRole` and `getByLabel` throughout. `getByTestId` (with `testIdAttribute: 'data-test'`) is used only where no role or label is unique, such as error labels and the cart badge. There is no XPath and no CSS chain. CSS appears only as a page-wide component root (`body`), for the `<html lang>` check, and for the cart's remove control, which has no role or name (A11Y-01).
- **Methods say what the user does.** Examples are `filters.filterByCategory('Pliers')`, `checkout.payment.payWith('cash-on-delivery')` and `search.searchFor('hammer')`. Each is wrapped in `test.step` by a small `@step` decorator, so traces read as a scenario.
- **Assertions live in tests**, as web-first `expect`. The custom matchers are `toBeSorted()` and `toShowAmount()` for money.
- **Admin.** `adminSession: 'mocked'` (default) installs the mocked back office as low-priority defaults, which a describe block overrides with `withMocks()`. `AdminListPage` is one class configured per list, and the forms compose an `AdminFormChrome`.
- **Accessibility.** The `a11y` fixture runs AxeBuilder with the WCAG tags and the stated exclusions, attaches the JSON, and returns findings as rule + target.
- **Auth.** `session: 'mocked'` uses a fake JWT plus mocked `/users/me` and runs everywhere. `storage-state` comes from the gated setup project. `worker-account` gives each worker its own real customer, registered on first use.

## What broke

Full list with reproduction notes in [docs/COVERAGE.md](docs/COVERAGE.md#bugs-found). The headline ones:

- **Silent failures everywhere** (BUG-03, 04, 05, 08, 10, 11, 13, 15, 23, 24, 25). A failed product list, cart, product, rentals or favourites request leaves a blank area or a misleading empty state. A failed search says "0 products found".
- **A failed order looks like a successful one** (BUG-17). When `POST /invoices/guest` returns 500 or 422, "Payment was successful" stays on screen and nothing tells the shopper.
- **Cart maths drift after an error** (BUG-14). A failed quantity update shows the new line total next to the old cart total.
- **Raw error text leaks out**: "[object Object]" (BUG-21), the literal "true" (BUG-22), and an untranslated `page.forgot-password.confirm` (BUG-20).
- **Validation gaps.** A future birth date is accepted (BUG-18). Credit Card can be checked with empty fields (BUG-16). An empty password change is sent to the server (BUG-26). "Show differences only" does nothing (BUG-12).
- **Back office** (mocked, so UI behaviour on given responses). Delete has no confirmation anywhere (ADM-02). Product prices like "abc" or "-5" are sent unvalidated (ADM-03). An existing product cannot be saved without retyping its stock (ADM-05). Empty replies are sent (ADM-06). Failed lists stay silent (ADM-07). The reports cannot show the current year (ADM-08).
- **axe: 19 violations, 6 critical** (AX-01..19). The checkout tabs break the ARIA tab pattern, three show-password buttons have no name, the chat fails colour contrast, the language button's name does not match its "EN" label, and the related-products links are too small to tap.
- **Accessibility.** The cart remove control and the password eye button have no accessible name, pagination "disabled" is CSS only, and Sign out is not a link (A11Y-01 to 04).
- **The shared backend wobbles.** In the final run, one window of `POST /carts` 500s, followed by a redirect to a 404, failed 5 Firefox cart tests even after three API retries and one test retry. A re-run passed 29/29. Arrange calls retry 5xx; nothing retries the act part, so a real UI failure is never hidden.
- **Test-design lessons.** `test.use()` reads a two-element array as `[value, options]` and silently dropped the second mock. `apiMocks` became an object for that reason (`withMocks()`). A late initial product response overwrote search results until every page opening waited for its feed. A second postcode-lookup answer overwrote typed addresses until the billing step waited for lookups to go quiet. The logo's accessible name is translated, so the header is scoped by its menubar.

## What I would change

- **Run the gated account specs on a schedule** against a disposable account, with credentials in CI secrets, so the signed-in purchase is covered every night and not only on demand.
- **Run the axe scan on Firefox and WebKit too, each with its own baseline.** Today it runs on Chromium only, because engines disagree in edge cases.
- **Keep Allure history** between Pages deployments, for trends and flakiness per test, and map `knownBug` to an Allure category so known failures sit apart from new ones.
- **Contract-check the mocks.** The payloads in `src/support/payloads.ts` and `admin-payloads.ts` mirror the API by hand. A nightly job that validates them against the live responses (or an OpenAPI spec) would catch drift before mocked tests start lying.
- **Pin action SHAs** instead of version tags, and let Renovate bump them.

---
Tools: Playwright, TypeScript, GitHub Actions, Allure · Part of the [qa-lab](https://github.com/fgacic?tab=repositories&q=topic:qa-lab) series.
