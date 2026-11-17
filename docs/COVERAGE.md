# Coverage

Every control and flow the research pass found on Toolshop (v5.0, sprint 5, Angular 20), what covers
it, and where it stands. API paths are relative to the API base: `https://api.practicesoftwaretesting.com`
on the live site, `http://localhost:4200/api` on the self-hosted copy. Product lists and search use the
HTTP method `QUERY` with a JSON body.

**Targets.** The gate is the self-hosted Toolshop (`TARGET=local`), built from upstream commit `ae7caec`,
the code the live site runs ("Built 2026-10-11"), and seeded fresh per CI job. The live site
(`TARGET=live`) has its own workflow, currently disabled; run it locally or on demand as a signal. Everything below runs on both targets unless a row says
*self-hosted only*.

**Columns.** *Pos* = positive case, *Neg* = negative case (validation, wrong input, navigation that
must not happen), *Fail* = API mocked to a 4xx/5xx or a network abort, *Empty* = API mocked to an empty
200 of the real shape. `yes` = covered, `n/a` = not meaningful for that control (no request, no data).

**Status.** `covered` = every applicable column has a passing test. `bug found` = covered, and at least
one test pins a site defect with `knownBug()` (see [Bugs found](#bugs-found)). `blocked` = deliberately
not automated, with the reason. `covered (self-hosted)` = runs for real on our own Toolshop in every CI
run; on the live site it stays gated behind `RUN_ACCOUNT_TESTS=1` / `RUN_ADMIN_TESTS=1`, because it uses a
real account on a public shop.

Locators: the suite uses roles and labels first. The **Locator** column shows what the spec uses, and
the data-test id in brackets where the role is not unique enough.

**Console guard.** Every test of the browser projects also fails if the page logged a `console.error` or threw an uncaught error that is not allowed. What is allowed suite-wide is in `src/support/console-guard.ts`, each entry with its reason: (1) the pinned defects' own logs, each only on the route of the page that raises it (BUG-02, BUG-37, BUG-38, BUG-47, BUG-54, SEC-13, ADM-21: the same TypeError on another page still fails); (2) the "Unauthorized" the shop logs when an anonymous page load asks `GET /users/me`, allowed only in a test whose browser received a 401 for that request (read from the response, so it holds in Chromium, Firefox and WebKit, which word the log differently; the SPA shares one request between subscribers that each log it, so it is not one log per 401); (3) the 404 and the 500 "Product with ID … not found" for an unknown product id, on the product page only; (4) a request WebKit cancels when the page moves on. The browser's own "Failed to load resource" for an API call is allowed only when the browser received a response of a status the suite expects (401, 404, 409, 422) for that very path (read from the responses, so a console line alone, with no such answer behind it, is not enough), or an answer one of the test's own mocks gave (that status, or an abort of that path); a real 5xx, a refused connection, a broken image or script fails the test. A test that provokes an error on purpose declares it with `consoleGuard.allow(pattern, reason)`; a mocked failure the SPA logs is declared with `allowLoggedFailure` (`LOGGED_FAILED_REQUEST`), which reads the line in each engine's shape (Chromium: `ERROR Error: Server Error`; Firefox prints the same line as `ERROR Error` or `ERROR JSHandle@object`, so the arguments are read) and allows it only in a test in which a request really failed (an API answer of 400 or more, a mocked one included, or a request a mock aborted: `requiresFailure`). Arguments are read through `consoleArgsText` (an Error by name and message, anything else as JSON), because the engines print an object differently. The guard found BUG-37, BUG-38, BUG-47, BUG-54 and SEC-13.

## Header and global navigation

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Logo / brand link back to home | link `/ - Toolshop$/` | – | yes | n/a | n/a | n/a | navigation/header | covered |
| Home, Contact, Sign in links | link by name in the menubar | – | yes | n/a | n/a | n/a | navigation/header | covered |
| Categories menu: Hand Tools, Power Tools, Other, Special Tools, Rentals | button "Categories", links by name | QUERY /products | yes | n/a | n/a | n/a | navigation/header | covered |
| Cart link with item count; it opens the cart with the quantity in its table | `[nav-cart]` | GET /carts/{id} | yes | yes (absent when empty) | n/a | n/a | navigation/header | covered |
| Signed-out state (Sign in, no account menu) | link "Sign in", `[nav-menu]` | GET /users/me (401) | yes | yes | n/a | n/a | navigation/header | covered |
| Mobile menu toggle (< 992 px): reveals the menu and hides it again (the slide is waited for) | button "Toggle navigation" | – | yes | n/a | n/a | n/a | navigation/header (@mobile) | covered |
| Account menu: My account, favorites, profile, invoices, messages | `[nav-menu]`, links by name | – | yes | n/a | n/a | n/a | account/account-area | covered |
| Sign out | `[nav-sign-out]` | – | yes | n/a | n/a | n/a | account/account-area | bug found (A11Y-04) |
| Language switcher: list of 7 (the count is asserted as the literal 7, and the languages are iterated by key) | button / menu "Select language" | – | yes | n/a | n/a | n/a | navigation/language | covered |
| Switch to de, el, en, es, fr, nl, tr | menuitem "DE"... | – | yes (×7) | n/a | n/a | n/a | navigation/language | covered |
| Language persists across reload and routes (the header text and `html[lang]` both) | `localStorage.language` | – | yes | n/a | n/a | n/a | navigation/language | covered |
| A stored language the shop does not offer (`xx`, an upper-case `DE`, an empty value, JSON) is ignored: the shop opens in English, the header and `html[lang]` say so; a stored supported language (`fr`) is the one it opens in | `localStorage.language`, button "Select language", `html[lang]` | – | yes (fr) | yes (×4) | n/a | n/a | navigation/language | covered |
| A translation file that fails to load (the German file answers 500): the shop should say so; it stays in English with no message, while the switcher and `html[lang]` already say German | button "Select language", the page | GET /assets/i18n/de.json (mocked 500) | n/a | yes | yes (500) | n/a | navigation/language-load | bug found (BUG-63) |

## Routing

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| /account, /favorites, /profile, /invoices, /messages redirect to login when signed out (the visit asks `GET /users/refresh` with no token, which answers 500: BUG-54, logged only on these routes) | URL | GET /users/refresh | n/a | yes (×5) | n/a | n/a | navigation/routing | bug found (BUG-54, see Session) |
| /admin when signed out | URL | – | n/a | yes | n/a | n/a | navigation/routing | bug found (BUG-01) |
| A signed-in customer opens `/auth/login`: the shop should not show the login form again (it does, and the customer stays signed in) | URL, form | GET /users/me (mocked session) | n/a | yes | n/a | n/a | navigation/routing | bug found (BUG-64) |
| A signed-in customer opens `/auth/register`: the same, the registration form is shown again | URL, form | GET /users/me (mocked session) | n/a | yes | n/a | n/a | navigation/routing | bug found (BUG-65) |
| Unknown route | URL, grid | – | n/a | yes | n/a | n/a | navigation/routing | bug found (BUG-02) |
| /compare is not a route (it is /comparison) | URL | – | n/a | yes | n/a | n/a | navigation/routing | covered |
| Admin area for a signed-in customer and for a visitor who is not signed in, on each of the 21 addresses below `/admin` (the eight sections, the reports, every add and edit form): the SPA's route guard sends both to the sign-in page, and the page behind the guard asks for nothing only the back office reads (mocked sessions: the SPA's guard, not the API's authorisation, which is in Security) | URL, `apiMock.expectNoRequest` | – (no `/invoices`, `/messages`, `/reports` or `/users/{id}` call) | n/a | yes (×21 for each of the two) | n/a | n/a | admin/access-control | covered |
| A signed-in customer on bare `/admin` keeps that URL and gets an empty page, while every address below it sends them to the sign-in page | URL | – | n/a | yes | n/a | n/a | admin/access-control | bug found (ADM-24) |
| Admin area | see [Back office](#back-office-admin) | | | | | | | |

## Banners and footer

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Notification bar "Documentation" link | link "Documentation" | – | yes (href, target) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Course promo "Explore courses" | link "Explore courses" | – | yes (href with UTM, target) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Footer: courses, API Spector, GitHub | links by name | – | yes (href, target, rel) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Footer: Privacy Policy reaches the privacy page | link "Privacy Policy" | – | yes (lands on /privacy) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Testing Guide: open, Next, Previous (disabled on step 1), Next disabled on the last step, Escape | button "Testing Guide", "Next →", "← Previous" | – | yes | yes (no way forward on the last step) | n/a | n/a | navigation/banners-and-footer | covered |
| Testing Guide "Mark as read" | checkbox "Mark as read" | – | – | – | – | – | – | blocked: a training aid outside the shop, with no visible effect beyond its own checkbox |
| "Bug Hunting" button | button "🐛 Bug Hunting" | – | – | – | – | – | – | blocked: opens a split-screen training panel; at 1280 px headless it rendered nothing visible to assert on |

## Product overview: search, sort, filters, pagination

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Product grid (cards: name, price, stock) | links with an h5 | QUERY /products | yes | n/a | yes (500, abort) | yes | catalog/filters | bug found (BUG-04) |
| Card image: alt text names the product (the same helper checks it on the category pages) | image by name | – | yes | n/a | n/a | n/a | catalog/product-grid | covered |
| Card of an out-of-stock product says so, and one in stock does not | text "Out of stock" | – | yes | yes | n/a | n/a | catalog/product-grid | covered |
| Search by button and by Enter | textbox / button "Search" | QUERY /products/search `{q}` | yes | yes (no match) | yes | yes | catalog/search | bug found (BUG-03) |
| Search caption and result count | `[search-caption]`, `[search-result-count]` | – | yes | yes | n/a | yes | catalog/search | bug found (I18N-21: the caption is English in every language) |
| Search then sort, and filter then search: each keeps the other applied | textbox "Search", combobox "sort", filters | QUERY /products/search `{q}`, QUERY /products | yes (×2) | n/a | n/a | n/a | catalog/search, catalog/filters | covered |
| Search with special characters (`o'brien`, `100%`, `%%%`, `___`, `a&b=c`, `"quoted"`, `<b>x</b>`): sent as typed, shown as text | textbox "Search" | QUERY /products/search `{q}` | yes (×7) | n/a | n/a | n/a | catalog/search | covered |
| Search with padded terms: the term is sent as typed, the caption shows it | textbox "Search" | QUERY /products/search `{q}` | yes | n/a | n/a | n/a | catalog/search | covered |
| Search submitted empty or blank | textbox "Search", button "Search" | – | n/a | yes (empty: nothing sent) | n/a | n/a | catalog/search | bug found (BUG-34, a spaces-only term is sent and shown as "0 products found for ' '") |
| Search term under 3 characters | textbox "Search" | – | n/a | yes | n/a | n/a | catalog/search | bug found (BUG-35) |
| Search terms of exactly 3 and exactly 40 characters (the valid boundaries) are sent and answered | textbox "Search" | QUERY /products/search `{q}` | yes (×2) | n/a | n/a | n/a | catalog/search | covered |
| Search term over 40 characters | textbox "Search" | – | n/a | yes | n/a | n/a | catalog/search | bug found (BUG-27) |
| Search reset "X" | button "X" | QUERY /products | yes | n/a | n/a | n/a | catalog/search | covered |
| Sort: 6 options; page 2 continues the order of page 1; sorting a filtered list keeps the filter | combobox "sort" | QUERY /products `{sort}` | yes (×6, page 2, and with a filter) | n/a | n/a | n/a | catalog/sort | covered |
| Category checkbox | checkbox by name | QUERY /products `{by_category}` | yes | n/a | yes | yes | catalog/filters | bug found (BUG-05) |
| Parent category ticks its subcategories | checkbox "Power Tools" | – | yes | yes (siblings stay unticked) | n/a | n/a | catalog/filters | covered |
| Brand checkbox; two brands together show the products of either | checkbox by name | QUERY /products `{by_brand}` | yes (×2) | n/a | yes | yes | catalog/filters | bug found (BUG-05) |
| Eco-friendly only | checkbox "Show only eco-friendly products" | QUERY /products `{eco_friendly}` | yes | n/a | n/a | n/a | catalog/filters | covered |
| Combined filters; untick restores; categories of different parents combine (the products of either) | – | QUERY /products | yes | n/a | n/a | n/a | catalog/filters | covered |
| Price slider, max and min handles (a test moves both handles) | slider "ngx-slider-max" / "ngx-slider" | QUERY /products `{between}`, one per one-dollar step | yes (both) | yes (a late answer for an earlier step; the minimum handle never ends above the maximum one) | n/a | n/a | catalog/filters | bug found (BUG-30) |
| Mobile "Filters" fold-out | button "Filters" | – | yes | n/a | n/a | n/a | @smoke specs on the mobile project | covered |
| Pagination: Next, Previous, Previous from page 2 back to page 1, page number, last page; Previous and Next from a middle page; a reload on a later page starts again at page 1; a search result that spans pages asks the search for the next page of the same term (mocked) | buttons "Next", "Previous", "Page-N" | QUERY /products `{page}` | yes | yes | n/a | yes (single page: no pagination) | catalog/pagination | covered |
| Pagination: the current-page marker (the `active` class on the list item) follows the page; a sort or filter change restarts at page 1 | list item around "Page-N" | QUERY /products `{page}` | yes | yes (the marker after a reset from a later page) | n/a | n/a | catalog/pagination | bug found (BUG-33) |
| Pagination end buttons disabled for assistive tech | button "Previous" | – | n/a | yes | n/a | n/a | catalog/pagination | bug found (A11Y-03) |
| A search that spans several pages ("er", 26 matches over 3 pages), in plain HTTP: every match is listed once, on one page, and the pages hold what the first page counted; and the later pages, asked of `/products` as the shop asks them, should hold the same products (they come from the list that leaves the rentals out, so the pager counts them and the last page comes up short) | – | QUERY /products/search `{q, page}`, QUERY /products `{q, page}` | yes | yes | n/a | n/a | catalog/search-paging (`@api`) | bug found (BUG-61) |

## Category pages and rentals

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| /category/hand-tools, power-tools, other (one test per claim: the category's products; its subcategories' products and nothing from elsewhere; every product of its subcategories; a card's picture is checked on every category) | `[page-title]`, grid | QUERY /products `{by_category_slug}` | yes (×9) | n/a | yes | yes (special-tools) | catalog/category-pages | bug found (BUG-04) |
| On a category page: sorting keeps it to that category, the pager shows the next page of that category, the filter panel narrows that category, and its brand filter narrows it to the brand (the request still names the category, and every product of the answer is that brand) | combobox "sort", buttons "Next", checkboxes | QUERY /products `{by_category_slug}` | yes (×4) | n/a | n/a | n/a | catalog/category-pages | covered |
| A parent category's total equals the sum of its subcategories' | grid, API totals | QUERY /products `{by_category_slug}` | yes | n/a | n/a | n/a | catalog/category-pages | covered |
| Each parent category lists the products of its subcategories, and nothing from elsewhere, on every page of the list (plain HTTP, no page opened) | – | QUERY /products `{by_category_slug, page}` | yes (×3) | n/a | n/a | n/a | catalog/category-contents (`@api`) | covered |
| Unknown category slug | `[page-title]` | QUERY /products | n/a | yes | n/a | n/a | catalog/category-pages | bug found (BUG-06) |
| Rentals list (only the seeded rentals are compared: a rental another worker made for its own test, named "QaLab …" or "Qa Lab …", is left out, because the back-office and stored-XSS specs make such rentals and the rentals page is the one list that shows them) | heading "Rentals", `[product-<id>]` | QUERY /products `{is_rental}` | yes | n/a | yes | yes | catalog/rentals | bug found (BUG-07, BUG-08) |
| Rental detail (no quantity picker) | heading, button "Add to cart" | GET /products/{id} | yes | n/a | n/a | n/a | catalog/rentals | covered |
| A rental goes into the cart as one unit of that product (the request body is asserted) | button "Add to cart" | POST /carts/{id} | yes | n/a | n/a | n/a | catalog/rentals | covered |

## Comparison

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Compare toggle on a card (aria-pressed); the selection survives navigation to another page | button "Compare" | – (sessionStorage) | yes | yes (toggle off) | n/a | n/a | catalog/compare | covered |
| Limit of 4 products (the fifth click is silently ignored: the shop gives no message, so the test proves it stays out of the bar and of the stored selection) | – | – | n/a | yes | n/a | n/a | catalog/compare | covered |
| Comparison bar: count, Clear All, Compare Now | `[comparison-bar]`, buttons by name | – | yes | n/a | n/a | n/a | catalog/compare | covered |
| Compare from the product page | button "Compare" | – | yes | n/a | n/a | n/a | catalog/compare | covered (no on-page feedback, see notes) |
| Comparison table rows (price, brand, category, availability, CO₂) | table "Product Comparison", rowheaders | POST /graphql | yes | n/a | yes | yes | catalog/compare | bug found (BUG-09) |
| Show differences only | checkbox "Show differences only" | – | yes | n/a | n/a | n/a | catalog/compare | bug found (BUG-12) |
| Remove one product; Clear All; Browse Products | buttons by name, link "Browse Products" | – | yes | yes (empty state) | n/a | n/a | catalog/compare | covered |
| A rental in the comparison has a column of its own with its price, brand and category, and is not called "Out of Stock" (the API marks the seeded rentals `in_stock: false`; the rentals page and the rental's own page offer them for hire) | table "Product Comparison", cells | POST /graphql | yes | yes | n/a | n/a | catalog/compare | bug found (BUG-60) |

## Product detail

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Name, price, description, specs (compared with the API's specification list) | h1, `[unit-price]`, `[product-description]`, table rows | GET /products/{id} | yes | n/a | yes (404, 500) | n/a | product/product-detail | bug found (BUG-11) |
| Quantity +/- (floor at 1; the + button stops at 99) | buttons "Increase/Decrease quantity", spinbutton "Quantity" | – | yes | yes (floor, ceiling) | n/a | n/a | product/product-detail | covered |
| Typed quantity 0, -1, empty, 2.5, > 99 | spinbutton "Quantity" | – | n/a | yes (×5) | n/a | n/a | product/product-detail | covered |
| Add to cart, toast, header count | button "Add to cart" | POST /carts, POST /carts/{id} | yes | n/a | yes (500, abort) | n/a | product/product-detail | bug found (BUG-10) |
| Add to favourites (signed out: a mocked 401 / in: the request body is asserted and the confirmation shown / duplicate) | button "Add to favourites" | POST /favorites | yes (mocked session) | yes (401 mocked, 422) | n/a | n/a | product/product-detail | covered |
| Related products (a related product is matched by id and opens its own page) | links with an h5 | GET /products/{id}/related | yes | n/a | yes (500: BUG-43) | yes | product/product-detail | bug found (BUG-43) |
| An id no product has: the product answers 404 and its related products should too (they answer 500 with an HTML error page), in plain HTTP | – | GET /products/{id}, GET /products/{id}/related | n/a | yes | n/a | n/a | product/product-related (`@api`) | bug found (BUG-62) |
| Out-of-stock state | text "Out of stock", disabled controls | – | n/a | yes | n/a | n/a | product/product-detail | covered |
| ECO badge | `[eco-badge]` | – | yes | n/a | n/a | n/a | product/product-detail | covered |

## Cart (checkout step 1)

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Lines: title, quantity, unit price, line total, cart total | table rows, `[line-price]`, `[cart-total]` | GET /carts/{id} | yes | yes (no cart; an out-of-stock line that is priced like any other: BUG-44, fixed by a notice or by a disabled Proceed) | yes (failed request: BUG-32) | yes | cart/cart | bug found (BUG-13, BUG-32, BUG-44) |
| Change quantity (the new quantity and totals are checked again after a reload) | spinbutton "Quantity for …" | PUT /carts/{id}/product/quantity | yes | yes (0, -1, empty, 2.5, > 99; the corrected value survives a reload) | yes | n/a | cart/cart | bug found (BUG-14, BUG-42: 2.5 is refused by the API with a 422, but the line keeps 2.5 and its total) |
| Quantity 99 is kept with no warning; 100 and 150 are capped at 99 with a warning, in the saved cart too | spinbutton "Quantity for …" | PUT /carts/{id}/product/quantity | yes (99) | yes (×2) | n/a | n/a | cart/cart | covered |
| Remove a line; remove the last line (the line stays gone after a reload) | remove control (CSS, see A11Y-01) | DELETE /carts/{id}/product/{pid} | yes | n/a | yes | n/a | cart/cart | bug found (BUG-15, A11Y-01) |
| Eco discount 5% (eco-only cart), with literal expected amounts from a mocked cart | `[cart-subtotal]`, `[cart-eco-discount]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| Eco discount in a mixed eco and normal cart | – | – | – | – | – | – | – | gap: a mixed cart shows no eco discount at all; whether that is intended is unclear, so it is not pinned |
| Combination discount 15% (rental + product), "price per hour" | `[cart-discount]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| Continue Shopping, Proceed to checkout | buttons by name, `[proceed-1]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| The same product added twice is one line with the summed quantity (kept after a reload, and in the header count) | `[line-price]`, cart link | POST /carts, /carts/{id} | yes | n/a | n/a | n/a | cart/cart | covered |
| Adding to a cart through the API, in plain HTTP: a product in stock is added (200) | – | POST /carts/{id} | yes | n/a | n/a | n/a | cart/cart-api (`@api`) | covered |
| The same call with a product that is out of stock: the shop should refuse it; it answers 200 "item added or updated", so the cart holds a line that cannot be bought (the half of BUG-44 the page cannot show) | – | POST /carts/{id} | n/a | yes | n/a | n/a | cart/cart-api (`@api`) | bug found (BUG-68) |
| The checkout page raises no application error for a cart that does not exist yet | – | – | n/a | yes | n/a | n/a | cart/cart | bug found (BUG-38) |

## Checkout steps 2–4

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Sign in / Continue as Guest tabs | tab by name | – | yes | n/a | n/a | n/a | checkout/sign-in-step | covered |
| Sign-in validation (empty, format, length); a padded email is trimmed before it is sent; after a refused sign-in the sign-in tab is still the selected one | labels, `[email-error]` | POST /users/login (mocked) | n/a | yes (×4) | n/a | n/a | checkout/sign-in-step | covered |
| Wrong credentials: the real failed login (self-hosted), and a mocked 401 twin that runs everywhere; a locked account (423, mocked) | `[login-error]` | POST /users/login (401, 423) | n/a | yes (×3) | n/a | n/a | checkout/sign-in-step | covered (real: self-hosted) |
| Guest details, confirmation, proceed | labels, `[proceed-2-guest]` | – | yes | yes (empty, bad email) | n/a | n/a | checkout/sign-in-step | covered |
| Signed-in checkout (proceed without guest step) | `[proceed-2]` | POST /invoices | yes | – | – | – | account/real-account | covered (self-hosted) |
| Billing address, Proceed disabled until complete (also with an empty house number, and, against the real lookup on the self-hosted shop, while the street, the city or the state is empty); changing the country after filling the address | labels, `[proceed-3]` | – | yes | yes | n/a | n/a | checkout/billing-step | covered |
| Billing: browser Back leaves the checkout and Forward returns to the cart with its lines (also from the payment step) | – | – | yes | n/a | n/a | n/a | checkout/billing-step, checkout/payment-step | covered |
| Billing: a malformed postcode is explained and Proceed stays disabled | labels, `[proceed-3]` | GET /postcode-lookup (mocked) | n/a | yes | n/a | n/a | checkout/billing-step | bug found (BUG-40) |
| Billing: answers arriving out of order; the address of the last house number is shown | labels | GET /postcode-lookup (mocked, one answer held back) | n/a | yes | n/a | n/a | checkout/billing-step | bug found (BUG-41) |
| Postcode lookup fills street / city / state | labels | GET /postcode-lookup | yes | yes (404) | yes (500) | n/a | checkout/billing-step | covered |
| Payment method list (5) | combobox "Payment Method" | – | yes | n/a | n/a | n/a | checkout/payment-step | covered |
| Fields per method: bank, card, BNPL, gift card; COD has none | labels | – | yes (×5) | n/a | n/a | n/a | checkout/payment-step | covered |
| Switching to another method and back empties the details typed for the first | labels | – | n/a | yes | n/a | n/a | checkout/payment-step | bug found (BUG-52) |
| A double click on Check payment sends one check (the answer is held until both clicks have landed, so the pin does not depend on speed or on the engine) | button "Check payment" | POST /payment/check (mocked, held) | n/a | yes | n/a | n/a | checkout/payment-step | bug found (BUG-53) |
| Field validation with non-numeric junk (bank transfer, card, gift card; every other field is filled validly first, so the disabled button proves the junk) | validation texts | – | n/a | yes (×3) | n/a | n/a | checkout/payment-step | covered |
| Credit card with empty fields | button "Check payment" | – | n/a | yes | n/a | n/a | checkout/payment-step | bug found (BUG-16) |
| BNPL: plans of 3, 6, 9 and 12 months; a chosen plan is sent (its request body is asserted as a structure) and the check passes (mocked); the check is disabled until one is chosen | select "Monthly Installments" | POST /payment/check (mocked) | yes (every target) | yes (self-hosted pin) | n/a | n/a | checkout/payment-step | bug found (BUG-29, self-hosted build) |
| Check payment → Confirm | `[payment-success-message]`, `[payment-error-message]` | POST /payment/check | yes | yes (400 declined) | yes (500) | n/a | checkout/payment-step | covered |
| Place order and confirmation (invoice number); a mocked 201 shows the issued number, and a double click on Confirm sends the order twice (mocked: the order is held until both clicks have landed, and no real order is placed) | text "Thanks for your order! …" | POST /invoices/guest | yes (mocked 201 and real) | yes (double click) | yes (500, 422) | n/a | checkout/payment-step, purchase-flow | bug found (BUG-17, BUG-46) |
| Card, bank and gift-card payments with real-looking numbers | – | POST /payment/check | – | – | – | – | – | blocked: the suite never types card, bank or gift-card numbers, not even fake ones |

Note on the payment methods: credit card, bank transfer and gift card never pass "Check payment" in the suite, by design. Only Cash on Delivery and Buy Now Pay Later (a chosen plan) reach a passing check; the other three are tested for their fields and for the rejection of junk, because the suite never types a card, bank or gift-card number, not even a fake one (checkout/payment-step).

## Purchase flows (@flow)

Add to cart and cart edits create **anonymous carts**, on the live site too: an accepted arrange write
(the write guard lets exactly these through). Placing an order does not, so it is `@self-hosted`.

| Flow | API calls | Spec | Status |
|---|---|---|---|
| Browse → product → cart → guest → billing → payment step (writes only an anonymous cart; the live-safe smoke) | POST /carts, /carts/{id} | checkout/purchase-flow | covered |
| Edit the cart: search ×3 → three products → change a quantity → remove a line; line prices from the API (anonymous carts, runs everywhere) | POST /carts, /carts/{id}, PUT, DELETE | checkout/purchase-flow | covered |
| Browse → product → quantity 2 → cart → guest → billing → Cash on Delivery → invoice number, cart emptied. A real `@self-hosted` test, and a mocked twin that runs everywhere | POST /carts, /carts/{id}, /payment/check, /invoices/guest | checkout/purchase-flow, checkout/payment-step | covered (self-hosted: places an order; the twin is mocked) |
| Order what the cart shows: the invoice total is the cart total, and the billing city is the city on screen | as above | checkout/purchase-flow | covered (self-hosted: places an order) |
| Order an eco-friendly cart: the invoice total is the discounted cart total | POST /carts, /invoices/guest | checkout/purchase-flow | covered (self-hosted: places an order) |
| Double click on Confirm places one order (mocked: `POST /invoices/guest` is held behind the answer gate until the second click has landed, and the requests that reach the handler are counted, so the pin is the same on every engine at any speed and places no real order) | POST /invoices/guest (mocked, held) | checkout/purchase-flow | bug found (BUG-46) |
| Browser Back from the sign-in step leaves the checkout; Forward returns to the cart with its lines | – | checkout/purchase-flow | covered |
| Signed-in purchase appears on the customer's invoices | POST /invoices, GET /invoices | account/real-account | covered (self-hosted) |

## Login, registration, password reset

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Login validation (empty, format, length) and no request sent | labels, `[email-error]`, `[password-error]` | – | n/a | yes | n/a | n/a | auth/login | covered |
| Unknown credentials: a real `@self-hosted` test and a mocked twin that runs everywhere | `[login-error]` | POST /users/login (401) | n/a | yes (×2) | n/a | n/a | auth/login | bug found (I18N-22: "Invalid email or password" is English in every language) |
| Successful login → account, signed-in header, the token stored (`TOKEN_KEY`) | – | POST /users/login, GET /users/me (mocked) | yes | n/a | yes (500, abort, 423 locked) | n/a | auth/login | covered |
| Two-factor (TOTP) step, empty code (no second request leaves) and a wrong code | textbox "TOTP Code", button "Verify TOTP" | POST /users/login (mocked) | yes | yes (×2) | n/a | n/a | auth/login | covered |
| Show/hide password | unnamed button | – | yes | n/a | n/a | n/a | auth/login, auth/register | bug found (A11Y-02) |
| Register / Forgot password links | links by name | – | yes | n/a | n/a | n/a | auth/login | covered |
| Submit with Enter: login (in the password field), forgot password and contact (in the email field) send what the button sends | textbox, Enter | POST /users/login, /users/forgot-password, /messages (mocked) | yes (×3) | n/a | n/a | n/a | auth/login, auth/forgot-password, contact/contact | covered |
| Sign in with Google | button "Sign in with Google" | – | yes (present) | – | – | – | auth/login | blocked: starts a real third-party OAuth flow; presence only |
| Registration: 12 required fields | labels, `[<field>-error]` | – | n/a | yes | n/a | n/a | auth/register | covered |
| Registration: date, phone, email, password formats | labels | – | n/a | yes (×5) | n/a | n/a | auth/register | covered |
| Registration: future date of birth | `[dob-error]` | – | n/a | yes | n/a | n/a | auth/register | bug found (BUG-18) |
| Registration: password rules, reveal (the page says at least 8 characters, the validation message "minimal 6") | list items, unnamed button | – | yes | yes (the two disagree) | n/a | n/a | auth/register | bug found (BUG-31) |
| Registration: password length pairs: 5, 6 and 7 characters are rejected by the form (nothing is sent), 8 is accepted | textbox "Password" | POST /users/register (mocked 201 for the 8) | yes (8) | yes (×3) | n/a | n/a | auth/register | covered |
| Registration: postcode lookup | labels | GET /postcode-lookup (mocked) | yes | n/a | n/a | n/a | auth/register | covered |
| Registration: a postcode lookup that fails (500): the address stays as typed and the form is still usable | labels | GET /postcode-lookup (mocked 500) | n/a | n/a | yes (500) | n/a | auth/register | covered |
| Registration submit: body, redirect to login; Enter in the email field submits | – | POST /users/register (mocked 201) | yes | yes (422 duplicate) | yes (500) | n/a | auth/register | covered |
| Registration submitted with Enter in the password field of a completely filled form | textbox "Password" | POST /users/register (mocked) | n/a | yes | n/a | n/a | auth/register | bug found (BUG-36) |
| Registration → login → account area | – | mocked register, login, me | yes | n/a | n/a | n/a | auth/registration-flow | covered |
| Same journey against the real API; duplicate email | – | real | yes | yes | – | – | account/real-account | covered (self-hosted) |
| Forgot password: empty, malformed, unknown email (the unknown email is a real `@self-hosted` test with a mocked twin) | `[email-error]`, alert | POST /users/forgot-password (422) | n/a | yes (×4) | n/a | n/a | auth/forgot-password | bug found (BUG-19) |
| Forgot password: accepted / failed | – | POST /users/forgot-password (mocked) | yes | n/a | yes | n/a | auth/forgot-password | bug found (BUG-20, also pinned in the translation suite as I18N-23: the same defect, counted once) |
| Session refresh, in plain HTTP: a valid token is refreshed (200) with a new token that signs in as the same customer (the control of the pin below); no token or a garbage one is refused with 401, not a server error | – | GET /users/refresh | yes | yes (no token, garbage) | n/a | n/a | auth/session (`@api`, self-hosted) | bug found (BUG-54) |

## Account area

Mocked session (fake JWT + mocked `GET /users/me`) unless marked gated.

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Account page tiles to four sections | `[nav-favorites]`... | – | yes | n/a | n/a | n/a | account/account-area | covered |
| Favorites list and remove | `[favorite-<id>]`, `[delete]` | GET /favorites, DELETE /favorites/{id} | yes | n/a | yes | yes | account/account-area | bug found (BUG-23) |
| Invoices list and invoice details; an account with no invoices (no rows, no failure notice, and the page should say so) | table rows, link "Details" | GET /invoices, GET /invoices/{id} | yes | n/a | yes | yes | account/account-area | bug found (BUG-24, BUG-48) |
| Invoice "Download PDF" | button "Download PDF" | GET /invoices/{n}/download-pdf | yes (present) | – | – | – | account/account-area | blocked: the PDF is generated asynchronously by the real backend; mocking it would only test the mock |
| Messages list, details, reply; a list that fails to load (500) and a reply the API refuses (500) | rows, link "Details", textbox "Message" | GET /messages, GET /messages/{id}, POST /messages/{id}/reply | yes | n/a | yes (500 on the list, 500 on the reply) | yes | account/account-area | bug found (BUG-49, BUG-50) |
| A refused session: a 401 on an authenticated account call (the token the shop no longer accepts) should send the customer to the login page and drop the session. The SPA sends them to `/#/auth/login`, which is not a route (home renders, the customer stays "signed in"), and leaves the refused JWT in storage with the account menu in the header | URL, `localStorage`, `[nav-menu]` | GET /invoices (mocked 401) | n/a | yes (×2) | yes (401) | n/a | account/account-area | bug found (BUG-56, BUG-57) |
| Profile shows the account's own details, update (the email is read-only) | labels, button "Update Profile" | GET /users/me, PUT /users/{id} | yes | yes (empty first name, malformed phone) | yes (422, 500 and a network abort on PUT /users/{id}: the failure is shown, not a success) | n/a | account/profile | covered |
| Profile address: saving sends the edited country, postal code and state (the body is asserted, the confirmation shown); an empty postal code is stopped by the form and nothing is sent | labels, button "Update Profile" | PUT /users/{id} (mocked) | yes | yes | n/a | n/a | account/profile | covered |
| Change password: success feedback, empty form, a confirmation that differs (the API's reason is shown, no success notice), a wrong current password; answering the request raises no application error | textboxes by name, button "Change Password" | POST /users/change-password | yes (success feedback) | yes (empty form, mismatch; 400 and 422 from the API) | yes (500: the failure is shown; a network abort: not reported, BUG-51) | n/a | account/profile | bug found (BUG-26, BUG-47, BUG-51) |
| Profile page raises no application error (the QR code widget) | – | POST /totp/setup (mocked) | n/a | yes | n/a | n/a | account/profile | bug found (BUG-37) |
| Profile TOTP setup | `[totp-secret]`, `[verify-totp]` | POST /totp/setup | – | – | – | – | – | blocked: enrolling 2FA needs a real authenticator secret from the real backend |
| Real session from storageState; per-worker account favorites | – | real | yes | – | – | – | account/real-account | covered (self-hosted) |

## Contact

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Subjects (6) | combobox "Subject" | – | yes | n/a | n/a | n/a | contact/contact | covered |
| Required fields (5) | labels, `[<field>-error]` | – | n/a | yes | n/a | n/a | contact/contact | covered |
| Email format, message < 50 characters (49 refused, exactly 50 accepted) | labels | POST /messages (mocked, for the 50) | yes (50) | yes (×2) | n/a | n/a | contact/contact | covered |
| Attachment: not empty, not .txt, empty .txt accepted | "Attachment", `[attachment-error]` | – | yes | yes (×2) | n/a | n/a | contact/contact | covered |
| Send: request body, confirmation, and the form replaced by the thanks (nothing typed stays for a second message) | button "Send", alert | POST /messages | yes (real on self-hosted, fake example.com sender; mocked 201 on every target) | n/a | yes (500, 422, abort) | n/a | contact/contact | bug found (BUG-21, BUG-22) |
| A message of only spaces (60 of them pass the 50-character minimum): the form should refuse it and send nothing | textbox "Message" | POST /messages (mocked 201) | n/a | yes | n/a | n/a | contact/contact | bug found (BUG-58) |
| A double-click on Send while the request is open (the answer is held until both clicks have landed, the pattern of BUG-46 and BUG-53): one message should be sent | button "Send" | POST /messages (mocked 201, held) | n/a | yes | n/a | n/a | contact/contact | bug found (BUG-59) |
| The form for a signed-in customer greets them by name and asks for no name or email; the message is sent under their name with their token; one under 50 characters is stopped by the form | `contact.greeting`, labels | POST /messages (mocked 201) | yes (×2) | yes | n/a | n/a | contact/contact | covered |

## Widgets

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Chat: open, greeting, menu, close; Enter in the message box sends it; Escape closes the window | buttons "Open chat", "Close chat" | – | yes | yes (Escape) | n/a | n/a | widgets/chat | bug found (BUG-45: Escape does not close the chat) |
| Chat: Find a product (a real `@self-hosted` test, and a mocked one with product cards that runs everywhere) | textbox "Message", button "Send message", `[chat-product]` | QUERY /products/search | yes (×2) | n/a | yes | yes | widgets/chat | bug found (BUG-25) |
| Chat: Checkout (empty cart), Back to menu (appends a second greeting and menu) | buttons by name | – | yes | yes | n/a | n/a | widgets/chat | covered |
| Chat: Order a product past the prompt: a search term lists the matches, then the chosen product and quantity are summarised | buttons and textbox by name | QUERY /products/search (mocked) | yes | n/a | n/a | n/a | widgets/chat | covered |
| Chat: support ticket (name, email, subject, message, skip attachment); email and message-length validation; a re-asked prompt is counted | buttons and textbox | POST /messages (mocked) | yes | yes (×2) | n/a | n/a | widgets/chat | covered |
| Chat: a ticket the API refuses (500) says it was not submitted, with the reason, and not that it was | transcript | POST /messages (mocked 500) | n/a | yes | yes (500) | n/a | widgets/chat | covered |
| Chat: a ticket whose request is aborted shows the literal text "true" after "There was an error submitting your ticket:" | transcript | POST /messages (mocked abort) | n/a | yes | yes (abort) | n/a | widgets/chat | bug found (BUG-55) |
| Chat: file attachment | `[chat-file-input]` | – | – | – | – | – | – | blocked: only reachable at the end of the ticket flow; the upload goes to the real messages API |
| Live activity: open (the real feed's window is visible), counters, the "Live" state while the feed is connected, close | button "Show live shop activity", `[live-activity-*]` | GET /sales-stream (SSE, mocked) | yes | n/a | n/a | yes | widgets/live-activity | covered |
| Live activity: feed unreachable; the feed drops, then reconnects | `[live-activity-*]` | GET /sales-stream (SSE, mocked) | n/a | n/a | yes (unreachable, drop then reconnect) | n/a | widgets/live-activity | covered |
| Live activity: one event that is not valid JSON: the sale after it is still listed and the counters count only the valid one | `[live-activity-item]` | GET /sales-stream (SSE, mocked) | n/a | yes | n/a | n/a | widgets/live-activity | covered |
| Live activity: incoming sales listed (built by a `fakeSale` factory), totals add up | `[live-activity-item]` | GET /sales-stream (mocked) | yes | n/a | n/a | n/a | widgets/live-activity | covered |
| Live activity: a sale that takes the last of a product (`sold_out`, `remaining_stock`) is marked as sold out, and only that one | `[live-activity-item]` | GET /sales-stream (mocked) | yes | yes (the other sales are not marked) | n/a | n/a | widgets/live-activity | covered |

## Back office (admin)

The admin helpers the mocked specs share live in `src/support` (the payloads in `admin-payloads.ts`, and `admin-deletable.ts`, which says which entities the back office can delete), next to the page objects they feed.

**Two layers, and what each one proves.** The *mocked* specs (`tests/admin`, run everywhere) sign in
with a fake admin JWT and answer every admin endpoint from `fixtures/admin.ts`. The responses are
shaped after the [OpenAPI document](https://api.practicesoftwaretesting.com/api/documentation).
They prove what the back-office UI renders, sends and shows for given responses: validation,
request bodies, success and error messages, empty and failing lists. They do **not** prove the real
backend: whether a product is really stored, permissions, or server-side validation. A guard refuses
(HTTP 418) any write no mock answers, and every page test asserts at teardown that none was
refused (`apiMock.blockedWrites` is empty), so a gap in the mocks fails the test and can never change
the shared shop. The guard is on by default on the live target; `apiMock` is no longer an auto fixture. The *e2e* specs (`tests/admin-e2e`, `@admin`) cover the real backend as the seeded
admin of the self-hosted Toolshop in every CI run; on the live site they are gated by
`RUN_ADMIN_TESTS=1` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Admin menu: Dashboard, Brands, Categories, Products, Orders, Users, Messages, Settings | account menu, links by name | – | yes | n/a | n/a | n/a | admin/dashboard-and-menu | covered |
| Admin menu: Reports submenu | button "Reports" | – | – | – | – | – | – | blocked: its items did not appear in headless runs when the button was clicked; the report pages are opened by URL instead |
| Product form: brand, category and image preselected when editing | combobox "Brand", "Category" | GET /products/{id} | n/a | yes | n/a | n/a | admin/product-form | bug found (ADM-09) |
| Dashboard: sales chart, orders awaiting fulfilment (the request's status filter is asserted), Edit; the menu's Dashboard link is tested from another section; a healthy dashboard shows no alert (watched over a time window) | heading, `canvas`, table | GET /invoices?in=status,…, GET /reports/total-sales-of-years | yes | n/a | yes | yes | admin/dashboard-and-menu | bug found (ADM-01) |
| Lists: products, brands, categories, orders, users, messages (an empty list shows no alert, watched over a time window) | heading, table rows | QUERY /products, GET /brands, /categories, /invoices, /users, /messages | yes (×6) | n/a | yes (×6) | yes (×6) | admin/* , admin/lists-failures | bug found (ADM-07) |
| List search that finds nothing (empties the table, no alert) and one that fails (500: the previous table stays and nothing is said) | textbox "Search …" | QUERY /…/search, GET /…/search | n/a | yes (no match) | yes (×6) | n/a | admin/lists-failures | bug found (ADM-18) |
| A list request refused with 401 (an expired or revoked session) on products, brands, categories, orders, users and messages: the admin should be sent to the sign-in page | heading, URL | QUERY /products, GET /brands, /categories, /invoices, /users, /messages (mocked 401) | n/a | yes (×6) | yes (×6) | n/a | admin/lists-failures | bug found (ADM-22) |
| An expired session (401) on the dashboard, the statistics, the sales reports per month and per week, and on a form save (a brand): the admin should be sent to the sign-in page, as on the lists | heading, URL | GET /invoices, /reports/…, PUT /brands/{id} (mocked 401) | n/a | yes (×5) | yes (×5) | n/a | admin/session-expired | bug found (ADM-25) |
| List paging: the second page of products, orders, users and messages is requested and replaces the first | pagination buttons | QUERY /products `{page}`, GET /invoices, /users, /messages `?page=` | yes (×4) | n/a | n/a | n/a | admin/lists-failures | covered |
| List search (products, brands, categories, orders, users) and reset (products) | textbox "Search …", buttons | QUERY /…/search `{q}` | yes (×6) | n/a | n/a | n/a | admin/products, brands, categories, orders, users | covered |
| Delete (products, brands, categories, users; `AdminTable.delete` answers a confirm dialog if one opens) | button "Delete" | DELETE /{entity}/{id} | yes (×4) | yes (product, brand, category and user in use: 409, the reason is shown and the row stays) | yes (×4: a 500 is shown and the row stays) | n/a | admin/delete (table-driven over the four entities: the delete, the 409 in use and the 500), delete-confirmation | bug found (ADM-02, pinned once per list: products, brands, categories, users; each also proves that dismissing the dialog sends no DELETE) |
| Product form: add (the body carries the image field), required fields, CO₂, brand, category, image | labels | POST /products | yes | yes (required, text price, negative price) | yes (422) | n/a | admin/product-form | bug found (ADM-03, ADM-04) |
| Product form: edit prefilled, save (a green edit asserts the PUT body and the confirmation; the stock and relations are pre-filled so ADM-05 and ADM-09 do not block it) | labels | GET /products/{id}, PUT /products/{id} | yes | n/a | n/a | n/a | admin/product-form | bug found (ADM-05) |
| Product form: a save of an edit the API refuses (409, 500): the failure is shown and nothing is reported as saved | labels, alerts | PUT /products/{id} (mocked 409, 500) | n/a | n/a | yes (×2) | n/a | admin/product-form | covered |
| Edit forms and detail pages whose record fails to load (product, brand, category, user, message: 500) | labels, alerts | GET /products/{id}, /brands/{id}, /categories/{id}, /users/{id}, /messages/{id} | n/a | n/a | yes (×5) | n/a | admin/product-form, admin/brands, admin/categories, admin/users, admin/messages | bug found (ADM-14: the form opens empty, with no message) |
| Baseline of the "a failure is reported" pins: on a healthy product, brand, category and user form, message and order, the locator that finds the failure message (`reportedFailure`) matches nothing, so a pin cannot go green for the wrong reason | alerts | GET /products/{id}, /brands/{id}, /categories/{id}, /users/{id}, /messages/{id}, /invoices/{id} (mocked) | yes (×6) | n/a | n/a | n/a | admin/healthy-pages | covered |
| Product specifications: list; add (the row shows the API's answer) and remove, each in a test of its own; an add or remove the API refuses (500) | `[specs-table]`, `[spec-name]`… `[add-spec]`, button "×" | GET/POST/DELETE /products/{id}/specs | yes (add, remove) | n/a | yes (add: reported; remove: not, ADM-19) | n/a | admin/product-specs | bug found (ADM-19) |
| Product form: the rental and location-offer ticks and each CO₂ rating are sent in the body | checkboxes, combobox "CO₂ rating" | POST /products | yes | n/a | n/a | n/a | admin/product-form | covered |
| Products list: each product with its stock status and price; search and Reset | table rows, textbox "Search …" | QUERY /products, /products/search | yes | n/a | n/a | n/a | admin/products | covered |
| Brand form: add, edit, required name and slug; a new brand the API refuses (409) and an edit it refuses (409, 500: ADM-23, nothing is reported) | labels, `[name-error]`, `[slug-error]` | POST /brands, PUT /brands/{id} | yes | yes (409 refused; a duplicate slug against the real API too) | n/a | n/a | admin/brands, admin-e2e/back-office.e2e | bug found (ADM-12, ADM-23) |
| Category form: add under a parent (the body's `parent_id` is asserted), edit (the parent is preselected and `parent_id` sent), required fields; a new category the API refuses (409) and an edit it refuses (409, 500: ADM-23, nothing is reported) | combobox "Parent Id", labels | POST /categories, PUT /categories/{id} | yes | yes (409 refused) | n/a | n/a | admin/categories | bug found (ADM-12, ADM-23) |
| Order: invoice, payment, billing, lines | textboxes by label, table | GET /invoices/{id} | yes | n/a | yes (500) | n/a | admin/orders | bug found (ADM-13: a failed load says "This invoice doesn't exist.") |
| Order: update status (every status other than the current one, which cannot be reselected) | combobox "Status", button "Update status" | PUT /invoices/{id}/status | yes | n/a | yes (409, 422, 500: the admin is told the status was not saved) | n/a | admin/orders | covered |
| User form: add (required fields; a new user is saved with what was entered), edit incl. Enabled and failed attempts; the password field is masked | labels | POST /users/register, PUT /users/{id} | yes (add, edit) | yes (required, email taken 422, a 422 on create) | n/a | n/a | admin/users | bug found (ADM-17, ADM-21: the password field is `type="text"`) |
| User form: a taken email on an edit shows the API's reason; an edit the API refuses (409, 500) shows the failure and nothing is reported as saved | labels, alerts | PUT /users/{id} (mocked 409, 500) | n/a | yes | yes (×2) | n/a | admin/users | covered |
| Message: read, status on change, reply (the reply shown is the refetched message's, not the typed text; the box is emptied) | combobox "Status", textbox "Reply message" | GET /messages/{id}, PUT …/status, POST …/reply | yes (reply confirmation) | yes (empty reply) | yes (a failed reply, a failed status save: neither is reported) | n/a | admin/messages | bug found (ADM-06, ADM-10, ADM-11) |
| Statistics: 4 report tables | headings, tables | GET /reports/top10-…, customers-by-country, total-sales-per-country | yes | n/a | yes | yes | admin/reports-and-settings | bug found (ADM-15: failed requests leave empty tables with no message) |
| Average sales per month / week: year picker, chart | combobox "Select year", `canvas` | GET /reports/average-sales-per-{month,week}?year= | yes (×2) | yes (current year) | n/a | n/a | admin/reports-and-settings | bug found (ADM-08) |
| Settings: payment endpoint, geolocation (persists after a reload), CO₂ features, eco badge, save, clear storage; a non-URL endpoint | labels, buttons | – (localStorage) | yes | yes (non-URL endpoint) | n/a | n/a | admin/reports-and-settings | bug found (ADM-16: a non-URL endpoint is accepted and "Settings saved!" is shown) |
| Settings take effect in the shop (CO₂ sort hidden; the eco badge switched off removes it from an eco product) | combobox "sort", `[eco-badge]` | – | yes | n/a | n/a | n/a | admin/reports-and-settings | covered |
| Order "add" route (/admin/orders/add) | – | – | – | – | – | – | – | blocked: no page links to it, and the API has no endpoint for an admin to create an order |
| Real: product create → listed in the shop → repriced → deleted (the product is a rental, so the shop's default list never shows it to parallel specs, and the `createdProducts` fixture (`fixtures/admin-cleanup.ts`) deletes it by its id in teardown, pass or fail; a user the form creates is removed by `createdUsers`; guest orders and contact messages cannot be deleted through the API and stay on the throwaway database, named "QaLab leftover" so they are told from anyone's data, which is why the self-hosted shop must be reseeded between local runs) | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: a product with a short word in its name is found by full-name search | as above | QUERY /products/search | n/a | yes | – | – | admin-e2e/back-office.e2e | bug found (BUG-28, self-hosted) |
| Real: a user added in the back office (the form's empty `enabled` and `failed_login_attempts` make the real API answer 500) | as above | POST /users/register | n/a | yes | – | – | admin-e2e/back-office.e2e | bug found (ADM-20, self-hosted) |
| Real: a brand renamed in the back office is listed under its new name by the API, and a brand deleted there is gone from it (the brand is made through a `brandFactory` that removes it in teardown) | as above | PUT /brands/{id}, DELETE /brands/{id} | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: a brand whose slug is taken is refused with a 409 and its reason, and the form says nothing | as above | POST /brands | n/a | yes | – | – | admin-e2e/back-office.e2e | bug found (ADM-12, self-hosted) |
| Real: a guest order (placed through the API) marked as shipped | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: a contact message (sent through the API) read, taken in progress and answered (the reply is stored by the real API and listed under the message) | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: statistics and monthly chart render from real data | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |

## Accessibility

An axe-core scan (`@axe-core/playwright` 4.14.0, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa`) of 55 pages and states, in `tests/a11y` (`npm run test:a11y`):

- **Shop:** home, search results, empty search, product (in stock, out of stock), category, rentals,
  comparison, the empty comparison, and the cart with items and the empty cart (11).
- **Checkout:** sign-in, guest step with errors, billing, payment, and the order confirmation (a mocked order) (5).
- **Forms and other pages:** login with errors, register with errors, forgot password and its confirmation (mocked), contact with
  errors, chat open, privacy, unknown route (8).
- **Account (mocked session):** 5 pages, and the profile with its errors shown (6).
- **Back office (mocked admin):** 16 pages and forms, the brand delete confirmation among them.
- **Phone width (320 px, WCAG 1.4.10 reflow):** home, a product, the cart, login and the checkout billing step, and the mobile menu open (6). AX-13 shows again here; the language button is not scanned while the header is folded behind its toggler, and is once the menu is open.
- **Opened states:** the language menu, the add-to-cart toast on a product page, and the compare bar (3).

Every scan waits for the page's fonts (`document.fonts.ready`) before it reads colours and sizes, so a late web font cannot change a contrast or target-size result. Every scan must give a `ready` step (the elements the page is about; the spec holds a per-page anchor table), and waits for it, so axe never runs on a half-rendered page; the spec runs with `reducedMotion: 'reduce'` set on the context, and the scan checks that it is, and the scan names come from one shared `ScanName` type. AX-04 and AX-10 are scanned in the states where they appear (login and registration with their errors shown). The element counts of AX-11 and AX-13 follow the shop's seed data, so they are compared exactly only on the self-hosted shop; elsewhere the violation must still be found where it was recorded and nowhere else. Every baseline id has a pin, and a test fails if one has none.

The full axe result of each scan is attached to the report, and so is the count of its `incomplete`
results (what axe could not decide), so a rule that goes quiet for lack of evidence is visible.

- **Scope.** The training-aid bar ("Testing Guide", "Bug Hunting") and its guide panel are excluded,
  because they are laid over the shop for testers and are not part of it. Everything else is
  scanned, the chat and live-activity widgets included. Each exclusion has a test (`EXCLUDED`) that the element it names is still drawn, so an exclusion cannot outlive what it excuses.
- **Baseline, a ratchet.** A scan fails on a violation outside `src/support/a11y-baseline.ts`, so it
  catches regressions. A known violation is matched by rule, element and page, and carries the
  number of elements it was recorded with and its impact: the same violation on another page, on more elements,
  or at a changed impact fails, and so does one that shrinks or is gone from a page it was recorded on, until the baseline
  is updated. The decision (new, grown, shrunk, impact changed, fixed) is one pure function, `diffFindings` in `src/support/a11y-baseline.ts`, which the scan calls and `tests/framework` table-tests case by case. A fix therefore cannot go unrecorded. Each one (`nth-child` indices removed) has its own `knownBug` pin, anchored on
  the offending element, that turns red when it is fixed.
- **Recording.** `A11Y_RECORD=<file>` makes every scan record its findings and assert nothing; the run says so loudly (an annotation on each test and a warning at the start), so a green recording is never read as a pass.
- **The keyboard, which axe cannot see** (`tests/a11y/keyboard.a11y.spec.ts`, Chromium only, no baseline): the Tab order of the header, then the sort and the price range, then the search, of the login form and of the product page follows the reading order (WCAG 2.4.3), each stop held to the region it belongs to; every header control, the first controls of the listing and the login form's fields, button and link draw a focus indicator (2.4.7), and control checks prove the indicator test tells a ring from a removed outline, does not take another change of pixels (a hover, an animation) for a ring, and refuses to judge a region that changes on its own; the language and categories menus open with Enter, close with Escape and keep the focus on their button. Opening the chat with the keyboard leaves the focus on the page body: AX-14. The cart (the quantity, Continue Shopping, Proceed to checkout, each with a focus indicator), the checkout sign-in step (its two tabs, then the form down to its links) and the account menu (opens with Enter, Tab walks its links, Escape closes it with the focus back on its button; every link draws a focus indicator) are walked too.
- **Zoom and text spacing** (`tests/a11y/reflow.a11y.spec.ts`, Chromium only, no baseline): five pages (home, a product, the login form, the contact form and the cart) at 200% (a 640 px wide viewport, which is what zoom does to the layout: the page fits without scrolling sideways, WCAG 1.4.4, 1.4.10), and the same five with the text spacing of WCAG 1.4.12 applied (line height 1.5, letter spacing 0.12 em, word spacing 0.16 em, paragraph spacing 2 em): no box cuts text it did not cut before. A control proves the clipping check lists a box that hides its overflow and not one that scrolls or fits. The 320 px phone width (400%) has its own checks above.
- **Chromium only.** axe reads the accessibility tree the browser builds, and Firefox does not report
  AX-01. The baseline is kept for one engine.
- **Scan settled states only.** A first baseline held six colour-contrast violations in the chat. They
  came from scanning while the chat was still fading in, which makes the text half-transparent. With
  `chat.open()` waiting for full opacity they are gone, locally and in CI. They were dropped from the
  baseline rather than pinned as defects the site does not have.
- **What axe does not see.** A11Y-01 (the cart's remove control is an `<a>` without href, so it is
  not focusable and axe skips it), A11Y-03 (pagination disabled by CSS only: a Previous pin and a Next pin) and A11Y-04 (Sign out
  without href) were found by the functional specs. They are pinned there.

| Status | Pages scanned | Distinct violations | Critical | Serious | Moderate | Minor |
|---|---|---|---|---|---|---|
| bug found (AX-01..AX-13) | 55 | 13 | 6 | 7 | 0 | 0 |

AX-14 and AX-15 are not axe findings: the keyboard checks found AX-14 (see above), and the cart's width on a 320 px screen is AX-15, measured by comparing the page's scroll width with the viewport, because axe has no rule for reflow. Neither has a baseline entry.

## Visual regression

Chromium at 1280×800 with animations off. The baselines are recorded and compared only inside
`mcr.microsoft.com/playwright:v1.64.1-noble` (`npm run test:visual` / `test:visual:update`), against the
freshly seeded self-hosted shop (two workers), so fonts, data and pixels match on every machine. The image is pinned by the digest of its linux/amd64 manifest and run as amd64 on every host, so an Apple Silicon Docker renders what CI renders. A colour counts as different from `threshold: 0.1` (Playwright's default is 0.2; 0.1 flags a real colour change and ignores anti-aliasing), and a screenshot may
differ by at most 150 such pixels, an absolute budget, but only for the full-page shots: that budget would miss a changed price digit (a mutation proves it), so the price (a product's and the first card's), the out-of-stock label and the cart total are cropped shots with a budget of 0 pixels and a colour threshold of 0.

**What the baselines cover.** One engine (Chromium), one theme (the shop has a single, light one), one desktop width (1280×800) and one phone width (390×844, the home page and the cart), English plus one German home page. A break that shows only in another engine, another width or a language other than English (the German home page apart) is not seen here; the functional specs and the axe reflow check carry what they can of that. The baseline files are PNGs in the repository (30 files, about 7 MB); `npm run test:visual:update` runs `--update-snapshots=changed`, so a re-record rewrites only the shots whose pixels moved and the diff shows exactly which. Should the folder grow past a few tens of megabytes (it is about 7 MB today), move it to Git LFS; history is not migrated.
Locale, time zone, colour scheme and reduced motion are pinned. Before the page shots every picture is loaded: the shop's grids use `loading="lazy"`, so the page's lazy images are made eager and the shot waits until each picture with a `src` is complete (`settleImages`, `src/support/visual.ts`), because a check that only looks at the pictures already requested passes before the lower ones are asked for. Masked: the product id on the admin form, the price
slider, related products (the API picks them), the generated guest email, and the dashboard's canvas
chart, which animates outside CSS. *Self-hosted only.*

| Page / state | Baseline | Spec | Status |
|---|---|---|---|
| Home, product, product out of stock, category, rentals | `home.png`, `product.png`, `product-out-of-stock.png`, `category.png`, `rentals.png` | visual/pages.visual | covered (self-hosted) |
| A price, the first card's price, the out-of-stock label and the cart total, each on its own with a 0 px budget and `threshold: 0` | `product-price.png`, `card-price.png`, `out-of-stock-label.png`, `cart-total.png` | visual/pages.visual | covered (self-hosted) |
| Home on a phone, and home with an empty catalogue (mocked) | `home-phone.png`, `home-empty-catalogue.png` | visual/pages.visual | covered (self-hosted) |
| Contact, login and registration with errors | `contact-errors.png`, `login-errors.png`, `register-errors.png` | visual/pages.visual | covered (self-hosted) |
| The empty cart (mocked), and the guest checkout form with its errors | `cart-empty.png`, `checkout-guest-errors.png` | visual/pages.visual | covered (self-hosted) |
| Cart with a product, checkout billing and payment steps | `cart.png`, `checkout-billing.png`, `checkout-payment.png` | visual/pages.visual | covered (self-hosted) |
| Chat open | `chat.png` (the chat window only) | visual/pages.visual | covered (self-hosted) |
| The home page in German (the longest words of the shop's header, filters and cards), the language menu open, a button hovered (Add to cart on a product page) and a field focused (the login email) | `home-de.png`, `language-menu.png`, `add-to-cart-hovered.png`, `email-focused.png` | visual/pages.visual | covered (self-hosted) |
| The cart on a phone (390 px) with a product | `cart-phone.png` | visual/pages.visual | covered (self-hosted) |
| Account page (mocked session), admin dashboard, product form, orders list and an order (mocked admin) | `account.png`, `admin-dashboard.png`, `admin-product-form.png`, `admin-orders.png`, `admin-order.png` | visual/pages.visual | covered (self-hosted) |
| Every baseline on disk belongs to a screenshot in the spec, whichever quoting style names it (an orphaned file fails) | – | visual/pages.visual | covered (self-hosted) |

30 baselines, 31 tests.

## Translations (i18n)

Thirty-two visits, in all 7 languages, each sampled only once the page's own content (a heading, a
form, the product grid) has rendered, and each starting from an explicit language:

- home, search without results, product, product with a toast, an unknown product, category, rentals, empty comparison, comparison with products, the
  empty cart and the cart with a product;
- checkout billing, checkout payment and the order confirmation;
- contact, login and registration, each with their validation errors shown, and login refused;
- forgot password, and forgot password sent;
- privacy policy, pinned as a whole (I18N-06);
- the signed-in account pages (account, favorites, invoices, messages, profile), and three of them again with records in them (favorites, invoices, messages with items);
- the chat open, the language menu open, and the home page on a phone with the header folded behind its toggler (I18N-26).

The scan reads visible text and the text a user gets in other ways: `<title>`, `placeholder`,
`aria-label`, `aria-description`, `aria-valuetext`, `aria-placeholder`, `title`, `alt`, button values, and the options of every list, the menus' items included. The product card is scanned too, except its name, price and image (shop data).

A page fails on a leaked translation key (dotted, like `nav.home` or `page.x.y`; the detector also catches keys in attributes and mixed case). The leak scan skips only real data (what a visitor typed, the shop's records); wording that is legitimately the same in every language is skipped only by the stray-English comparison below, so a key leaking there is still caught. It also fails on text identical to
the English rendering of the same page, except:

- the shop's data (product, brand and category names, descriptions, prices);
- the training-aid bar and the build line;
- words a language shares with English ("Contact" in French and Dutch, "Home" in Dutch).

Each known item is excluded only in the languages it was pinned in: the language guard is applied per
language, so I18N-08 (the logo's tooltip) is German and French only, and I18N-19 (the card form) German only. The known items live in `src/support/i18n-baseline.ts` (`KNOWN`), and each is pinned once per language it covers: 219 pin tests across 26 ids.

The key detector has one documented limit, held by `translation-keys` rather than worked around: a key whose only other segment is a number (`errors.404`) looks like a decimal or a version, so it is not reported (longer keys such as `errors.404.title` are). A key of two short segments (`ui.ok`, `nav.go`) is reported: the abbreviations the shop's text holds are listed by name (`e.g`, `i.e`, `d.h`, `z.B`, `π.χ`, `U.S`) and nothing else of that shape is skipped.

Chromium only: translation files do not depend on the engine.

| Check | Spec | Status |
|---|---|---|
| No leaked keys (32 visits × 7 languages) and no stray English (32 visits × 6 languages), one test per visit and language | i18n/completeness | covered (with the known items below excluded) |
| Positive control: a key missing from the German file is reported as a leak (in text and in an `aria-label`), and a value left in English as stray English, so a green scan cannot mean a blind one | i18n/completeness | covered |
| The seven translation files (`assets/i18n/<language>.json`) hold the same keys as English, no value is empty, and every language keeps the `{{ placeholders }}` of the English value, compared with each other without opening a page | i18n/translation-files | bug found (I18N-27, I18N-28) |
| No translation file drifts from English beyond the known differences: the keys and the placeholders each file lacks or drops, minus the ones pinned as I18N-27 and I18N-28, must be empty, so a new drift is a failure of its own and not a quiet change of the pinned ones | i18n/translation-files | covered |
| Amounts and dates follow the language, on an order with a fixed total and date (mocked, the language chosen in the header): the total should be written as the browser's own `Intl` format of that language writes it (a control proves two languages differ, so the pin can tell), and the date should not be the database timestamp | invoices list, language menu | GET /invoices (mocked) | n/a | yes (×7 languages, and the date) | n/a | n/a | i18n/formats | bug found (I18N-29: every language shows `$1234.50`, no thousands separator and no comma where six languages write one; I18N-30: the order date is the raw `2026-11-01 10:00:00`) |
| The key detector itself, on real page text (no false positives on emails, URLs, prices, abbreviations) | i18n/translation-keys | covered |
| Untranslated areas, one pin per id and language | i18n/completeness | bug found (I18N-01..26) |
| The forgot-password confirmation shows its raw key (I18N-23 is BUG-20 seen here: two pins, one defect, counted once) | auth/forgot-password, i18n/completeness | bug found (BUG-20, I18N-23) |

## Security (UI)

Payloads (`<img src=x onerror=…>`, `<script>…</script>`, an attribute breakout with `<svg onload=…>`, and, for values that land in an HTML attribute, a quote that adds a focus handler, a `srcdoc`, a `javascript:` URL and an entity-encoded quote)
are typed as plain text. Each payload, if it ran, would call a function the sentinel exposes to the
page, and the sentinel also wraps `alert`, `confirm` and `prompt`, so execution is seen with or
without a dialog. It is installed before the first navigation. After an action the spec waits for
images and timers to settle, then watches for a documented 1 s window, checks that no injected
element exists, and that the payload comes back as text. A positive control injects each payload
into a page the way a vulnerable sink would and proves the sentinel catches it. It has a control for
every payload (the three attacks, and their tagged-template forms for the address bar), for the
element each one leaves behind (in iframes and shadow roots too, which `injectedCount` reaches), and for a dialog opened in the page, in a popup the page opened
and in a tab of its own, so a payload that runs anywhere in the browser context is seen. Settling the page does not disarm an image still loading, and a control proves that. The visitor's own context, where a stored payload is shown to somebody else, has a sentinel and a control of its own. The basic payloads stay under 40
characters, because the search drops longer terms (BUG-27); the attribute payloads are longer (up to 51), so the search is given only those that fit.

| Input | Where it is shown | Target | Spec | Status |
|---|---|---|---|---|
| Search box (3 payloads, and the attribute payloads that fit the box's 40 characters) | search caption | both (read-only) | security/xss-reflected | covered |
| Chat "Find a product" (3 payloads) | chat transcript | both (read-only) | security/xss-reflected | covered |
| Contact message (API) | admin inbox list and message page | self-hosted only | security/xss-stored | covered (self-hosted) |
| Brand name (admin form) | admin brand list, the storefront's brand filter and the admin product form's brand list | self-hosted only | security/xss-stored | covered (self-hosted) |
| First name at registration | header account menu after login | self-hosted only | security/xss-stored | covered (self-hosted) |
| Contact form submission (guest, script tag included) | admin inbox | self-hosted only | security/xss-stored | covered (self-hosted) |
| A product's description (3 payloads), shown below the name on the product page and under the card on the rentals list | product page, rentals list | self-hosted only | security/xss-stored | covered (self-hosted) |
| A customer's last name and street, saved on the profile | header account menu, profile fields | self-hosted only | security/xss-stored | covered (self-hosted) |
| A product's name, in the picture's `alt` attribute (the rentals card's too) and as text: an attribute payload that adds a focus handler, one that adds a `srcdoc`, a `javascript:` URL and an entity-encoded quote (4 payloads; the sentinel has a control for each, a vulnerable sink and a safe one) | storefront card and product page, in the text and in the attribute | self-hosted only | security/xss-stored | covered (self-hosted) |
| Route segment `/category/<payload>` (3 payloads, as tagged templates) | the page title: echoed, title-cased | both (read-only) | security/xss-reflected | covered |
| Route segment `/product/<payload>` (3 payloads) | not echoed (nothing is shown of the id); must still not run | both (read-only) | security/xss-reflected | covered |
| The sentinel itself (a control for every payload and its injected element, a dialog in the page, in a popup and in a tab, and an inline script that calls `alert` while the page loads, which proves the sentinel is installed before any page script) | – | both | security/xss-sentinel | covered |
| Response headers: CSP (without `*`, `data:`, `https:`, `http:` or `'unsafe-eval'` sources, which let scripts load from anywhere or turn text into code), X-Frame-Options or CSP frame-ancestors, `nosniff`, Referrer-Policy, HSTS max-age of at least 15552000 s, Server (real values judged by matchers, not presence; a Cloudflare challenge skips instead of satisfying a pin) | – | live only (headers belong to the deployment) | security/headers | bug found (SEC-01..06) |
| Cookie flags (Secure, HttpOnly, SameSite; guarded, so a site with no cookie is not read as a pass), CORS with credentials from an unknown origin, Permissions-Policy for camera, microphone and geolocation (checks, not pins: a red nightly run is the finding) | – | live only | security/headers | covered |
| The header matchers themselves (`directivesOf`, `limitsScripts`, `hstsMaxAge` and its 180-day bound, nosniff, Referrer-Policy, framing, Permissions-Policy), run offline on sample header values: what each refuses and what it accepts, and that the unsafe-source list is the one the pin quotes | – | offline (no site) | security/header-matchers (`@framework`) | covered |
| Authorisation of the API: 401 without a token on `/users/me`, `/invoices`, `/favorites`, `/messages`, `/users` and the reports; 403 for a customer on the admin endpoints (users, three reports); another customer's invoice and account refused; DELETE of brands, categories and products refused | – | self-hosted only | security/authorization | covered (self-hosted) |
| Forged tokens on an admin-only path (`GET /users`): the real admin token is accepted there, and a changed signature, an altered payload with the old signature, `alg: none` with and without a signature, a made-up unsigned admin token, text that is not a token, and a customer's token with its role changed to admin and the old signature are all refused | – | self-hosted only | security/authorization | covered (self-hosted) |
| List scoping: a customer's `GET /invoices`, `/favorites` and `/messages` hold only their own rows (the other customer's records are made through the API and read back) | – | self-hosted only | security/authorization | covered (self-hosted) |
| Role mass assignment: the admin can set a role through `PUT /users/{id}`, and a customer cannot make themselves an admin through their own profile (the role of a fresh sign-in is read from the token's claims) | – | self-hosted only | security/authorization | covered (self-hosted) |
| Tokens after the session ended: a token is refused once its holder signed out; the token of an account the admin deleted should be too, and all five calls a signed-in customer makes (`/users/me`, `/invoices`, `/favorites`, `/messages`, `/users/refresh`) still accept it, each judged on its own with a sign-in of its own (a refresh retires the token it is called with) | – | self-hosted only | security/authorization | bug found (SEC-14) |
| Authorisation of writes to other records: another customer's profile cannot be changed and their account cannot be deleted, their favourite survives a refused delete (and the customer can remove their own), an order's and a message's status cannot be set anonymously; every write is read back as the admin, and an admin control proves the same calls work for the admin | – | self-hosted only | security/authorization | covered (self-hosted) |
| Who may set a status: a customer cannot set an order's or a message's status; and another customer's favourite is refused, not answered with a success | – | self-hosted only | security/authorization | bug found (SEC-10 orders, SEC-11 messages, SEC-12 favourites) |
| Authorisation of the catalogue writes: create and update of a brand, category and product refused to an anonymous caller and to a customer | – | self-hosted only | security/authorization | bug found (SEC-07 brands, SEC-08 categories, SEC-09 products) |
| Cart ids: an id that was never issued is answered 404 to an anonymous caller and to a customer, and the random part of each of five new carts is different (ids are not a counter) | – | GET /carts/{id}, POST /carts | n/a | yes | n/a | n/a | security/cart-access | covered (self-hosted) |
| A cart a signed-in customer made answers anybody who has its id: another customer's token, or none, can read it, add a line to it and delete it | – | GET, POST, DELETE /carts/{id} | n/a | yes | n/a | n/a | security/cart-access | bug found (SEC-15, self-hosted) |
| Login lockout: three wrong passwords lock a customer account (423), and the right password is refused after (a control signs in first) | – | POST /users/login | yes | yes | n/a | n/a | security/login-lockout | covered (self-hosted) |
| An account with the admin role never locks, however many wrong passwords are sent (all 401) | – | POST /users/login | n/a | yes | n/a | n/a | security/login-lockout | bug found (SEC-16, self-hosted) |
| No rate limit on sign-in: 30 wrong passwords for addresses nobody has, from one client, are all answered 401 and never 429 | – | POST /users/login | n/a | yes | n/a | n/a | security/login-lockout | bug found (SEC-17, self-hosted) |

The payload checks watch for a documented 1 s window after the page settles. That is the blind spot of every "nothing ran" check here: a payload that fires its script after more than a second (a long timer, a slow network call it starts itself) is not seen, so a pass says "nothing ran inside the window", not "nothing can ever run".

The header checks are soft: they are defence in depth, not functional defects, and the shop is a
training site. They are pinned so that a header appearing turns the live run red.

The authorisation specs write to our own database, so they run on the self-hosted shop only, once, in Chromium (`@api`: nothing in them depends on the browser). Every record they make, customers included, is created under a unique "Qa Lab Authz …" name through the admin's token and removed in teardown, pass or fail (a customer is found by email and deleted through `findUserByEmail`, registered before the sign-in so a failed sign-in still cleans up). Products are created as rentals, which the shop's default list never shows, so a record that exists for a moment cannot disturb the catalogue specs running in parallel. The lists that do show rentals (the rentals page, a search, the pick of "any rental") compare only the seeded products and leave out any named "QaLab …" or "Qa Lab …" (`SUITE_OWNED_NAME`). A cleanup that fails inside a pin is recorded as a `cleanup failed` annotation rather than lost.

## Performance

Measured with the browser's own PerformanceObserver entries (Chromium only: WebKit has no LCP,
layout-shift or longtask entries):

- LCP is the last largest-contentful-paint before input;
- CLS is the sum of shifts without recent input;
- TBT is the long-task time above 50 ms, counted only for tasks before the first input (the cost of loading, not of the interaction), and the window opens at First Contentful Paint (as Lighthouse's does), so a task that began before there was anything on screen is not blamed on the page; a check fails the measurement when no FCP, no LCP, no input or no interaction was counted;
- the INP proxy is the longest event duration of the interactions the test makes.

The thresholds are Core Web Vitals "good" limits: LCP 2.5 s, CLS 0.1, INP 200 ms, and Lighthouse's
200 ms for TBT. Every measurement is attached to its test. *Self-hosted only:* live numbers would
measure Cloudflare and the network, not the shop.

How it is measured, so the numbers mean something:

- in a `perf` project of its own, one worker, no retries (the median of 5 absorbs the noise a retry would hide), nothing else running;
- 4× CPU throttling and a 40 ms, 10/5 Mbps network (a mid-range phone on a good connection), cache off, so every sample is a cold load;
- the median of 5 fresh page loads per budget, each product sample starting from an empty cart (`freshCart`), so one sample's add to cart cannot change the next;
- a test fails if no LCP or no interaction was observed, so an empty measurement can never pass;
- a run that schedules `perf` next to another project is refused by the run-guard reporter;
- a second control puts a click handler that blocks for a known time on a test page and requires the INP proxy to report at least that much, so an INP of 16 to 32 ms means "fast" and not "event timing not collected";
- a control test runs a known 150 ms task before any interaction and requires the blocking time to count at least 100 ms of it, so the zeros reported for TBT mean "no long task" and not "observer asleep". (A task blocking inside `page.evaluate` is not reported as a long task by the browser, so the control runs it from a timer.)
- the phone loads (`home-mobile`, `product-mobile`) use a Pixel 7 screen, touch and pixel ratio under the same throttling and are only loaded, not clicked, so the INP proxy is not asserted for them (LCP and TBT are);
- the page weight is counted over the wire for the first load of home and of a product page (bytes, requests and script bytes), with no throttling, no collector and no baseline file: the sizes are the same every run, so each has a fixed ceiling alone (the measured value plus about 25%, rounded up to 50 kB or 2 requests), and a control counts a known document.

**Baseline limit, per environment.** The absolute budgets above only catch a gross regression, so each
budget also has a limit relative to a recorded baseline: the median plus a margin of the largest of 3 times the spread seen across the 5 samples when it was recorded, 5% of the median, and a noise
floor (LCP 100 ms, CLS 0.02, TBT 50 ms, INP proxy 32 ms; see `fixtures/performance.ts`); the margin is capped at 2 times that floor, so one noisy recording cannot widen the limit past meaning. `tests/performance/baseline.json` holds
the medians and spreads in one set per environment: `ci` when `CI` is set, otherwise `local`, keyed by a hash of the CPU model and core count, because medians
recorded on one machine mean nothing on another. The baseline is enforced only when an entry for the
current environment exists. When none does, the test attaches the measured medians with an annotation saying so (on CI also a workflow warning), and the absolute budgets still apply. The baseline holds the LCP and TBT of the five budget pages and the two phone loads and the CLS of the slow-API pages whose shift is steady (home, contact and the cart), the PERF-01 pages included: their CLS is ratcheted so a pinned page cannot get worse either. INP, and the product page's CLS, are too noisy to record.
- `local`: `UPDATE_PERF_BASELINE=1 npx playwright test --project=perf --workers=1`, on an idle machine
  (the one-minute load average under 4 when the run begins). Recording is refused above that load, from a second worker, and from a run that failed.
- `ci`: run the CI workflow by hand with the `record_perf_baseline` input. The `record-perf-baseline`
  job records it on a runner and uploads `baseline.json` as the `perf-baseline-ci` artifact; committing
  it back is a human step.

Medians of 5 on the self-hosted shop, `local` baseline (recorded at a one-minute load average of 3.7 when the run began; the limit is 4): LCP 1.04–1.26 s (home 1224, search 1224, product 1264, cart 1048, contact 1044 ms; on a phone, home 1216 and product 1260 ms), INP proxy
16–32 ms (not recorded: too noisy to ratchet), TBT 0. The INP control, a click handler that blocks for 300 ms, reads 304 ms. TBT stays at 0 even throttled (the first load has no long task above 50 ms), so that
budget is weak on this app; the control above is what shows the collector would see one. CLS on the 500 ms API: home 0.258, product 0.23–0.38 (too noisy across samples to be recorded, so the product page is held by its fixed ceiling, 0.38, alone), contact 0.17, cart 0.107.

**Fixed ceilings, on every machine.** The CI baseline cannot be recorded without a push, so each measurement also has a fixed ceiling in `tests/performance/budgets.spec.ts` (`CEILING`) that holds with or without a recorded baseline, derived from the values above with the margin written next to it: LCP the recorded median times 1.5 rounded up to 50 ms (home and search 1900, product 1950, cart 1600, contact 1600 ms; on a phone, home 1850 and product 1900 ms), TBT 100 ms (half the budget and twice the noise floor; recorded 0), the INP proxy 80 ms (2.5 times the highest recorded median, 32 ms, and 3 to 5 times the others; the budget is 200 ms), and CLS on the slow API the recorded median plus about 20% (home 0.31, product 0.38, contact 0.21, cart 0.13). On CI the time ceilings (LCP, TBT, INP, not CLS, which is a race with the network and not with the CPU) are multiplied by 1.5 until a `ci` baseline is recorded, and never above the budget. The baseline limit is the tighter ratchet under them where one is recorded, for LCP, TBT and CLS; **INP has no baseline ratchet**: every recorded INP spread (32 to 48 ms, event timing is rounded to 8 ms) is wider than the margin cap allows, so it is not written to the baseline and is held only by its ceiling and the budget. Each sample must also have made the inputs the test expects (a missed click is not a fast interaction).

**Noisy metrics, and the host.** A metric whose margin (3 times its spread) would exceed the cap is not recorded (the run annotates it as noisy), so it is not enforced as a ratchet (the fixed ceiling and the budget still apply); record it again on an idle machine. Every perf test annotates the host's one-minute load average (at the end of its measurement and when the run began), and recording needs the run to have begun under a load of 4 (a platform with no load average is refused) and a single worker, and is written only after the console guard and the write guard have passed. The margin arithmetic is `ratchetLimits` in `fixtures/performance.ts`, tested on its own in `tests/framework/performance-maths`.

| Page and interaction | LCP / TBT / INP | CLS (500 ms API) | Spec | Status |
|---|---|---|---|---|
| Home, filter click | within budget | 0.26 | performance/budgets | bug found (PERF-01) |
| Search for a term | within budget | – | performance/budgets | covered |
| Product: quantity, add to cart | within budget | 0.23–0.38 | performance/budgets | bug found (PERF-01) |
| Cart: proceed to sign in | within budget | 0.107 (the same in every sample): held to a fixed 0.13 ceiling and to its baseline, not pinned | performance/budgets | covered (observation) |
| Collector controls: a known 150 ms task is counted as blocking time, and a known slow click as the interaction time | – | – | performance/budgets | covered |
| Home, product and contact: the shift is held to its recorded baseline by a passing test of its own (not an `@bug` pin), so a pinned page cannot get worse (the product page's shift varies too much between samples to be recorded: its fixed ceiling alone holds it) | – | 0.17–0.38, ratcheted where steady | performance/budgets | covered (where a baseline is recorded) |
| Contact: submit empty | within budget | 0.17 | performance/budgets | bug found (PERF-01) |
| Home and a product on a phone (a Pixel 7 screen, touch and pixel ratio, the same 4× CPU and 10 Mbps; loaded and not clicked, so LCP and TBT only): the main content is drawn within the budgets, the fixed ceilings (LCP 1850 and 1900 ms, TBT 100 ms) and the baseline (recorded medians 1216 and 1260 ms, TBT 0) | within budget | – | performance/budgets | covered |
| Page weight of the first load of home and of a product page, over the wire as the container sends it (nginx does not compress here), cache off: home 1.8 MB, 50 requests, 1.15 MB of scripts; product 1.7 MB, 44 requests, 1.15 MB of scripts (the measured values plus about 25%: home 1.42 MB in 40 requests, product 1.33 MB in 34, scripts 0.91 MB); a control counts a known document | bytes, requests, script bytes | – | performance/budgets | covered |

PERF-01 pins home, product and contact only (CLS 0.17 to 0.38). The cart's 0.107 is the same footer
shift sitting a hair over the 0.1 line, so a different font render could pass it "fixed" without anyone
touching the shop; a pin that noise can flip cannot tell a fix from luck. It is measured, kept under a fixed ceiling (0.13, `CEILING['cart-slow-api']`) that holds on every environment, kept to its own
baseline where one is recorded so it cannot get worse, and carries no `@bug` tag.

**Why CLS is measured on a slow API.** The footer is painted before the routed page has its data,
then pushed down. At full speed, whether a run catches that depends on whether the first paint beats
the API: 0 to 0.32 across repeats, which would make the budget flaky. With 500 ms of API latency, a
realistic mobile figure, the shift happens every time (12 of 12 runs).

## Bugs found

Every entry below was reproduced by the suite. The pinned test states the behaviour the shop should have
and is wrapped in `knownBug()` (`test.fail`): it passes while the bug exists and fails the day it is
fixed. `npm run test:verify-bugs` runs every `@bug` test as an ordinary test, in every project that schedules it (a pin scheduled in Chromium, Firefox and WebKit is verified three times, because an engine nobody verifies is only judged by the e2e job, which can say red but not why), and checks that each fails for its own reason: the first error names the pin's id, is an assertion, and comes from the spec. A pin that fails for another reason, and a pin that passes, is rerun alone before the verdict, so a slow moment is not a broken pin and a race that happened to be lost is not a fix. The perf pins run in a pass of their own; `--project=<name>` and `--skip-project=<name>` verify a subset (CI runs one shard per engine and one for the other projects); the `@live-only` pins (SEC-01..06) are listed as not verifiable on the self-hosted target.

### Functional

| ID | Where | What happens | Pinned in |
|---|---|---|---|
| BUG-01 | /admin | Signed out, /admin keeps its URL and renders an empty page instead of redirecting to login. | navigation/routing |
| BUG-02 | Unknown routes | Redirects to / but the product grid never renders. | navigation/routing |
| BUG-03 | Search | A failed search (500) is shown as "0 products found for '…'", as if nothing matched. | catalog/search |
| BUG-04 | Overview, category pages | A failed or unreachable product list leaves the grid blank with no message. | catalog/filters, catalog/category-pages |
| BUG-05 | Filters | Failed category and brand requests leave empty filter groups with no message. | catalog/filters |
| BUG-06 | /category/{slug} | Any slug gets a page titled after the slug ("Category: …") with an empty grid; no "not found". | catalog/category-pages |
| BUG-07 | Rentals | An empty rentals list shows only the heading, no empty state. | catalog/rentals |
| BUG-08 | Rentals | A failed rentals request blanks the whole page, heading included. | catalog/rentals |
| BUG-09 | Comparison | A failed comparison request says "No products selected", although products are selected. | catalog/compare |
| BUG-10 | Add to cart | When the cart request fails at network level, the button does nothing at all: no toast, no error. | product/product-detail |
| BUG-11 | Product page | A missing (404) or failing (500) product renders an empty page with only "Related products". | product/product-detail |
| BUG-12 | Comparison | "Show differences only" hides nothing; rows where both products agree stay visible. | catalog/compare |
| BUG-13 | Cart | With no cart, only the step header shows: not "The cart is empty". | cart/cart |
| BUG-14 | Cart | After a failed quantity update the line total shows the new quantity while the cart total keeps the old one. | cart/cart |
| BUG-15 | Cart | A failed remove does nothing visible: no toast, the line just stays. | cart/cart |
| BUG-16 | Payment | With Credit Card chosen and every field empty, "Check payment" is enabled. | checkout/payment-step |
| BUG-17 | Payment | A rejected order (500, or the API's 422 "city does not belong to the country") leaves "Payment was successful" on screen with no error. The shopper cannot tell the order failed. | checkout/payment-step |
| BUG-18 | Registration | A date of birth in the future (2099-01-01) is accepted. | auth/register |
| BUG-19 | Forgot password | For a malformed email the error label appears, but empty. | auth/forgot-password |
| BUG-20 | Forgot password | The success message is the raw translation key `page.forgot-password.confirm`. | auth/forgot-password |
| BUG-21 | Contact | A 422 is shown as "The given data was invalid. [object Object]". | contact/contact |
| BUG-22 | Contact | A network failure is shown as the literal text "true". | contact/contact |
| BUG-23 | Favorites | A failed favorites request says "There are no favorites yet", which is not true. | account/account-area |
| BUG-24 | Invoices | A failed invoices request shows the bare page title: no table, no message. | account/account-area |
| BUG-25 | Chat | A failed chat search answers "No products found. Try a different search." | widgets/chat |
| BUG-26 | Profile | "Change Password" with every field empty is sent to the API instead of being validated in the form. | account/profile |
| BUG-27 | Search | A search term over 40 characters is silently ignored: no request, no message. | catalog/search |
| BUG-28 | Search | A full-name search finds nothing when the name has a word under 3 letters (every word is required, MariaDB's full-text index drops short ones). | admin-e2e/back-office.e2e (self-hosted) |
| BUG-29 | Payment | Buy Now Pay Later: "Check payment" is enabled before a plan is chosen, and checking answers "Unknown error". Seen on the self-hosted build in all three engines; the live deployment disables the button. | checkout/payment-step (self-hosted) |
| BUG-30 | Filters | Every one-dollar step of the price slider sends its own request, none is cancelled, and the grid shows whichever answer arrives last. A slow answer for an earlier step replaces the final filter: products below the chosen minimum stay listed. Found as a flaky test under load, then reproduced by holding one answer back. | catalog/filters |
| BUG-31 | Registration | The page lists "at least 8 characters" for the password; the validation message says "minimal 6 characters long". | auth/register |
| BUG-32 | Cart | A failed cart request shows only the step header: no lines and no message. (Split from BUG-13.) | cart/cart |
| BUG-33 | Pagination | After a sort or filter change from a later page, the list restarts at page 1 but the pager still marks the old page as current, or none. Pinned twice: once for a sort change and once for a filter change. | catalog/pagination |
| BUG-34 | Search | A search of only spaces is sent and shown as "0 products found for ' '"; an empty one sends nothing. | catalog/search |
| BUG-35 | Search | A search term under 3 characters is silently ignored: no request, no message. | catalog/search |
| BUG-36 | Registration | On a completely filled registration form, pressing Enter in the password field answers "Password is required" and registers nobody. Enter in the email field works. | auth/register |
| BUG-37 | Profile page | The page draws its two-factor QR code from an empty secret and logs "[angularx-qrcode] Field `qrdata` is empty" as a console error on every visit. Found by the console guard. | account/profile |
| BUG-38 | Checkout | The checkout reads `cart_items` of a cart that does not exist (yet, or any more) and throws a TypeError, again on every change of the page; the page still draws. Found by the console guard. | cart/cart |
| BUG-40 | Billing | A postcode the lookup refuses as malformed is explained, but Proceed stays enabled once the rest of the address is typed. | checkout/billing-step |
| BUG-41 | Billing | Each change of the house number sends its own address lookup and the page applies whichever answer arrives last, so a slow answer for an earlier number overwrites the address of the final one. | checkout/billing-step |
| BUG-42 | Cart | A quantity of 2.5 is refused by the API (422), but the line keeps 2.5 and its total. | cart/cart |
| BUG-43 | Product page | A failed related-products request (500) leaves the "Related products" heading over nothing, with no message. | product/product-detail |
| BUG-44 | Cart | A product that is out of stock can sit in the cart: the line is priced like any other, with no notice, and Proceed to checkout stays enabled (a notice, or a disabled Proceed, would fix it). | cart/cart |
| BUG-45 | Chat | The chat window does not close on Escape, as a dialog is expected to: only its close button does. | widgets/chat |
| BUG-46 | Payment | A double click on Confirm sends `POST /invoices/guest` twice, so two invoices are created for one cart. | checkout/purchase-flow |
| BUG-47 | Profile page | Each time the change-password request is answered, whatever the answer, the page throws "TypeError: Cannot read properties of undefined (reading 'value')"; it still shows the answer. Found by the console guard, against the real API too. | account/profile |
| BUG-48 | Invoices | An account with no invoices shows the bare table header and no empty-state text, unlike the favorites and messages pages. | account/account-area |
| BUG-49 | Messages | A failed messages request (500) says "There are no messages yet", which is not true. | account/account-area |
| BUG-50 | Messages | A reply the API refuses (500) is not reported: no alert, no message, and the reply box keeps its text without a word. | account/account-area |
| BUG-51 | Profile page | A change-password request that never reaches the API (a network abort) is not reported: no alert, although a failed profile save says "An unexpected error occurred". | account/profile |
| BUG-52 | Payment | The details typed for a payment method stay in the form when another method is chosen, and are still there when the shopper comes back to the first. | checkout/payment-step |
| BUG-53 | Payment | A double click on "Check payment" sends the check twice. | checkout/payment-step |
| BUG-54 | Session | `GET /users/refresh` with no token, or a garbage one, answers 500 (an unhandled `JWTException`, "Token could not be parsed") instead of 401, so every signed-out visit of a protected page (/account and its sections) logs a server error in the browser. A valid token is refreshed (200, and the old one is refused afterwards), so the defect is the refusal, not the renewal. | auth/session (self-hosted) |
| BUG-55 | Chat | A support ticket whose request is aborted (no answer at all) is followed by the literal text "true" after "There was an error submitting your ticket:", where the reason should be. | widgets/chat |

| BUG-56 | Account area | A 401 on an account call sends the SPA to `/#/auth/login`, which is not a route: home renders and the user stays signed in. | account/account-area |
| BUG-57 | Account area | That 401 leaves the stale JWT in storage and the account menu visible. | account/account-area |
| BUG-58 | Contact | The contact form sends a message of only spaces (60 spaces pass the 50-character minimum). | contact |
| BUG-59 | Contact | A double-click on Send posts the contact message twice. | contact |
| BUG-60 | Comparison | The comparison lists a rental as "Out of Stock". | catalog/compare |
| BUG-61 | Search | Later pages of a search come from `/products`, drop the rentals, and the last page comes up short. | catalog/search-paging |
| BUG-62 | Product | `/products/<unknown>/related` answers 500 (HTML) where the product answers 404. | product/product-related |
| BUG-63 | Language switcher | A translation file that fails to load (500) leaves English with no message. | navigation/language-load |
| BUG-64 | Login | A signed-in customer who opens `/auth/login` gets the login form again. | navigation/routing |
| BUG-65 | Registration | A signed-in customer who opens `/auth/register` gets the registration form again. | navigation/routing |
| BUG-68 | Cart | `POST /carts/{id}` adds a product that is out of stock (200, "item added or updated"). | cart/cart-api |

BUG-39, BUG-66 and BUG-67 were never assigned.

### Accessibility

| ID | Where | What happens | Pinned in |
|---|---|---|---|
| A11Y-01 | Cart | The remove-line control is an `<a>` with an icon, no href and no accessible name: neither a link nor a button. | cart/cart |
| A11Y-02 | Login, register, profile | The eye button that reveals the password has no accessible name. | auth/login |
| A11Y-03 | Pagination | End buttons are only styled as disabled (a class on the `<li>`); the `<button>` stays enabled and focusable. The current page has no `aria-current`. Pinned twice: a Previous pin and a Next pin. | catalog/pagination |
| A11Y-04 | Account menu | "Sign out" is an `<a>` without href: no link role, not reachable with Tab. | account/account-area |

### Back office

Found with the mocked back office, so each is UI behaviour on a given response.

| ID | Where | What happens | Pinned in |
|---|---|---|---|
| ADM-01 | Dashboard | Failed dashboard requests leave an empty chart and table with no message. | admin/dashboard-and-menu |
| ADM-02 | All lists | Delete acts on the first click, with no confirmation. Pinned once per list (products, brands, categories, users); each pin also proves that dismissing the dialog sends no DELETE. | admin/delete-confirmation |
| ADM-03 | Product form | Any price is sent to the API unvalidated: text ("abc") and negative ("-5") alike. | admin/product-form |
| ADM-04 | Product form | "Quantity is required" stays on screen next to "Product saved!" although Stock is filled in. | admin/product-form |
| ADM-05 | Product form | The edit form does not load the stock, so saving an existing product is blocked by "Quantity is required" until it is retyped. | admin/product-form |
| ADM-06 | Messages | An empty reply is sent to the API (`{"message":""}`) instead of being validated. | admin/messages |
| ADM-07 | All lists | A failed list request shows an empty table and no message, in every section. | admin/lists-failures |
| ADM-08 | Sales reports | The year picker stops at 2025 and opens on it; the current year cannot be chosen. | admin/reports-and-settings |
| ADM-09 | Product form | Editing leaves Brand, Category and Image empty (the API sends `brand` / `category` / `product_image` objects, the form expects `*_id` fields), so saving is blocked, without a message, until all three are chosen again. Confirmed against the real backend. | admin/product-form |
| ADM-10 | Messages | A failed reply (500) is not reported to the admin: no message. | admin/messages |
| ADM-11 | Messages | A failed message status save (500) is not reported: the picker keeps showing the new status. | admin/messages |
| ADM-12 | Brand and category forms | A save the API refuses (409, slug taken) is not reported: no message, nothing happens. A real duplicate slug answers 409 with its reason and is pinned against the real backend too. | admin/brands, admin/categories, admin-e2e/back-office.e2e |
| ADM-13 | Order page | An order whose load fails (500) shows "This invoice doesn't exist.", the message for a missing one. | admin/orders |
| ADM-14 | Edit forms | An edit form or detail page whose record fails to load (product, brand, category, user, message) opens empty, with no message: saving it would write blanks. | admin/product-form, admin/brands, admin/categories, admin/users, admin/messages |
| ADM-15 | Statistics | Failed statistics requests show empty tables with no message. | admin/reports-and-settings |
| ADM-16 | Settings | A non-URL payment endpoint is accepted and "Settings saved!" is shown. | admin/reports-and-settings |
| ADM-17 | User form | The password field is `type="text"`: the password is shown in clear text. | admin/users |
| ADM-18 | All lists | A failed search in a back-office list (500) leaves the previous table on screen and says nothing, so the admin takes it for the result. | admin/lists-failures |
| ADM-19 | Product form | A specification the API refuses to remove (500) stays in the list and nothing says so. | admin/product-specs |
| ADM-20 | User form | The back office cannot create a user: the add form sends empty `enabled` and `failed_login_attempts` values and the real API answers 500 "Something went wrong". | admin-e2e/back-office.e2e (self-hosted) |
| ADM-21 | User form | After the API accepts a new user (201) the SPA throws an unhandled Angular error (NG01002, "Must supply a value for form control") although the form says "User saved!". | admin/users |
| ADM-22 | All lists | A list request refused with 401 (an expired or revoked session) leaves the admin on the page with an empty table and no word: they are not sent to the sign-in page. Pinned once per list (products, brands, categories, orders, users, messages). | admin/lists-failures |
| ADM-23 | Brand and category forms | An edit the API refuses (409, 500) is not reported: the form stays as it was. | admin/brands, admin/categories |
| ADM-24 | /admin | A signed-in customer who opens bare `/admin` keeps that URL and gets an empty page, while every address below it sends them to the sign-in page. | admin/access-control |
| ADM-25 | Dashboard, statistics, sales reports, form saves | A 401 (an expired session) on the dashboard, the statistics, the sales reports per month and per week or a form save (a brand) leaves the admin on the page instead of sending them to the sign-in page (ADM-22 is the same on the lists). | admin/session-expired |

### Accessibility (axe)

| ID | Rule | Impact | WCAG | Element | What |
|---|---|---|---|---|---|
| AX-01 | aria-required-children | critical | 1.3.1 | `.nav` (checkout) | The sign-in / guest tablist contains list items instead of tabs. |
| AX-02 | aria-required-parent | critical | 1.3.1 | "Sign in" tab | Not directly inside its tablist. |
| AX-03 | aria-required-parent | critical | 1.3.1 | "Continue as Guest" tab | Not directly inside its tablist. |
| AX-04 | button-name | critical | 4.1.2 | show-password button (login, register) | No accessible name (same defect as A11Y-02). |
| AX-05 | button-name | critical | 4.1.2 | show-password, "New Password" (profile) | No accessible name. |
| AX-06 | button-name | critical | 4.1.2 | show-password, "Confirm New Password" (profile) | No accessible name. |
| AX-07 | color-contrast | serious | 1.4.3 | status badges (admin inbox) | Too little contrast. |
| AX-08 | label-content-name-mismatch | serious | 2.5.3 | language button (every page) | Shows "EN", named "Select language": voice control by its label fails. |
| AX-09 | label-content-name-mismatch | serious | 2.5.3 | cart link | Shows the item count, which its name does not contain. |
| AX-10 | list | serious | 1.3.1 | password rules (register, profile) | The list contains non-list children. |
| AX-11 | list | serious | 1.3.1 | subcategory lists in the filters | The lists contain groups instead of list items. |
| AX-12 | listitem | serious | 1.3.1 | checkout tab items | List items outside a list (the parent's role is overridden). |
| AX-13 | target-size | serious | 2.5.8 | "More information" on related products | Smaller than 24×24 px and too close together. |
| AX-14 | keyboard focus (not axe) | – | 2.4.3 | the chat button and window | Opening the chat with Enter leaves the keyboard focus on the page body: the button that had it is gone and nothing in the window takes it. Found by the keyboard checks (a11y/keyboard), not by a scan. |
| AX-15 | reflow (not axe) | – | 1.4.10 | the cart table on a phone | On a 320 px screen the cart table keeps about 370 px and the page scrolls sideways. Found by comparing the page's scroll width with the viewport (a11y/pages), not by a scan. |

### Translations

| ID | What stays English in the other languages (all six, unless noted) | Pinned in |
|---|---|---|
| I18N-01 | The notification bar: "View the Documentation for this application." | i18n/completeness |
| I18N-02 | The page heading "Practice Software Testing - Toolshop" (visually hidden, read by screen readers). | i18n/completeness |
| I18N-03 | The footer: "Privacy Policy", "Banner photo by … on Unsplash". | i18n/completeness |
| I18N-04 | "Sign in with Google". | i18n/completeness |
| I18N-05 | Registration: the date-format error, the four password rules, the strength meter labels. | i18n/completeness |
| I18N-06 | The whole privacy policy page. | i18n/completeness |
| I18N-07 | The product page's "Quantity" label (hard-coded in the template). | i18n/completeness |
| I18N-08 | The logo's tooltip, "Practice Software Testing - Toolshop" (German and French only). | i18n/completeness |
| I18N-09 | The header's aria-labels: "Main menu", "nav-categories" (an internal id), "Select language". | i18n/completeness |
| I18N-10 | The floating buttons' aria-labels: "Open chat", "Show live shop activity". | i18n/completeness |
| I18N-11 | The sort and price-range aria-labels: "sort", "Sort products", "ngx-slider", "ngx-slider-max" (library ids). | i18n/completeness |
| I18N-12 | The pagination aria-labels: "Previous", "Next", "Page-1". | i18n/completeness |
| I18N-13 | The login page's aria-labels: the methods group, the Login button, the forgot-password and register links. | i18n/completeness |
| I18N-14 | The product page's aria-labels "category" and "brand" (ids). | i18n/completeness |
| I18N-15 | The home banner image's alt text, "Banner". | i18n/completeness |
| I18N-16 | The page titles (browser tab) of checkout, login, register, forgot password, contact, privacy, comparison and rentals, and of the five account pages (overview, favorites, invoices, messages, profile): 13 pins, one per title and visit. | i18n/completeness |
| I18N-17 | The cart link's aria-label, "cart" (an internal id). | i18n/completeness |
| I18N-18 | The cart lines' label "Quantity for …". | i18n/completeness |
| I18N-19 | The credit-card form's labels, hints and placeholders (German only). | i18n/completeness |
| I18N-20 | The chat window's "Close chat" aria-label. | i18n/completeness |
| I18N-21 | The search caption, "Searched for:". | i18n/completeness |
| I18N-22 | The error for unknown credentials at login, "Invalid email or password". | i18n/completeness |
| I18N-23 | The forgot-password confirmation shows its raw key, `page.forgot-password.confirm`. **The same defect as BUG-20**: both are pins (the functional spec and the translation scan test different surfaces), but it is counted once, under BUG-20. | i18n/completeness |
| I18N-24 | The profile page's aria-label "TOTP code". | i18n/completeness |
| I18N-25 | The status badge of a message in the account list shows the API's raw value, `NEW`. | i18n/completeness |
| I18N-26 | The menu toggler's aria-label on a phone ("Toggle navigation", the framework's default). | i18n/completeness |
| I18N-27 | The English translation file lacks `fields.address.label`, `.placeholder` and `.errors.required`, which the six other files define (a key one file lacks shows as its raw name in that language). Found by comparing the files with each other, not by a page. | i18n/translation-files |
| I18N-28 | The Greek `pages.comparison.remove-product` drops the `{{ name }}` placeholder the English value fills in ("Remove {{ name }} from comparison"), so the remove button of a comparison column has no product in its name. Found by comparing the files' placeholders. | i18n/translation-files |
| I18N-29 | Amounts are written `$1234.50` in every language: no thousands separator, and the point where German, Greek, Spanish, French, Dutch and Turkish write a comma. | i18n/formats |
| I18N-30 | The order date is the raw database timestamp (`2026-11-01 10:00:00`), with the seconds and no regard for the language. | i18n/formats |

### Security

SEC-01..06 are the response headers of the live site; SEC-07..12 are authorisation of the API, checked on the self-hosted shop; SEC-13 is an uncaught error on the category route; SEC-14 is a token the API still accepts after its account was deleted; SEC-15 is a cart that answers anybody with its id; SEC-16 and SEC-17 are the missing limits on sign-in. The next free id is SEC-18.

| ID | Finding | Pinned in |
|---|---|---|
| SEC-01 | No Content-Security-Policy. | security/headers |
| SEC-02 | No X-Frame-Options or CSP frame-ancestors: the shop can be framed (clickjacking). Pinned as "the shop cannot be framed". | security/headers |
| SEC-03 | No X-Content-Type-Options: nosniff. | security/headers |
| SEC-04 | No Referrer-Policy. | security/headers |
| SEC-05 | No Strict-Transport-Security. | security/headers |
| SEC-06 | The API answers with `Server: Apache/2.4.52 (Ubuntu)`, disclosing product, version and OS. | security/headers |
| SEC-07 | `POST /brands` and `PUT /brands/{id}` accept an anonymous caller and a customer's token. | security/authorization (self-hosted) |
| SEC-08 | `POST /categories` and `PUT /categories/{id}` accept an anonymous caller and a customer's token. | security/authorization (self-hosted) |
| SEC-09 | `POST /products` and `PUT /products/{id}` accept an anonymous caller and a customer's token. | security/authorization (self-hosted) |
| SEC-10 | `PUT /invoices/{id}/status` is accepted from a customer: anybody with an account can change an order's status. | security/authorization (self-hosted) |
| SEC-11 | `PUT /messages/{id}/status` is accepted from a customer. | security/authorization (self-hosted) |
| SEC-12 | `DELETE /favorites/{id}` by another customer answers 204 (success) although nothing is deleted: the refusal is reported as a success. | security/authorization (self-hosted) |
| SEC-13 | The category page throws "TypeError: Cannot read properties of undefined (reading 'name')" for a slug it does not know (any slug from the address bar), though it still draws. Found by the console guard. | security/xss-reflected |
| SEC-14 | The token of a deleted account is still accepted: `GET /users/me` answers 200, and so do `/invoices`, `/favorites`, `/messages` and `/users/refresh` (all five calls are pinned, each on its own). | security/authorization (self-hosted) |
| SEC-15 | A customer's cart answers anybody who has its id: another customer's token, or none, can read it (`GET`), add a line to it (`POST`) and delete it (`DELETE`). | security/cart-access (self-hosted) |
| SEC-16 | An account with the admin role never locks: any number of wrong passwords is answered 401, while a customer account locks after three (423). | security/login-lockout (self-hosted) |
| SEC-17 | No rate limit on sign-in: 30 wrong passwords for addresses nobody has, from one client, are all answered 401 and never 429. | security/login-lockout (self-hosted) |

### Performance

| ID | Finding | Pinned in |
|---|---|---|
| PERF-01 | The footer renders at the top before the page content arrives, then jumps down: CLS 0.17 to 0.38 on home, product and contact, against a 0.1 budget. (The cart, at 0.107, is an observation held to a fixed ceiling and to its baseline, not a pin: see Performance.) | performance/budgets |

### Observed, not pinned

These are real, but a deterministic UI test would only restate the observation:

- **After `migrate:fresh --seed`, Laravel's file cache keeps serving product lists with the old ids**
  ("The selected product id is invalid" on add-to-cart) until the 5-minute cache expires.
  `scripts/toolshop.sh` clears the cache after every seed.
- **The tag 2.5 build differs from what the live site runs** (why the self-hosted shop is built from a commit) (for example, accessible names on the admin
  search boxes), which is why the self-hosted target is built from a commit.
- **The postcode lookup fires twice per change, and its late answer overwrites typed fields** (the race itself is pinned as BUG-41). Combined
  with the API's rule that the city must belong to the country, a shopper who types their own city can
  end up with an order rejected silently (BUG-17). The suite keeps the address the lookup suggests.
- **The lookup returns plausible but random addresses** for any postcode in any country.
- **Compare on the product page gives no feedback**: no bar, no toast. The product does reach /comparison.
- **The shared demo data drifts**: other users' test categories ("TesztKategoria11") appear in the public
  filters, and stock flips (Combination Pliers went out of stock during this work). This is why the suite
  looks every product up at runtime and never assumes fixed counts.
- **Rental cards** are focusable `<div>`s rather than links.
- **The API document lists `POST /products`, `PUT /products/{id}`, `POST /brands`, `POST /categories` and
  their `PUT`/`PATCH` without a security requirement**, while `DELETE` requires a token. Verified on the self-hosted shop: the writes are accepted from anonymous callers and customers (SEC-07..09), and the deletes are refused. Not checked on the live site, where the suite does not write.
- **The order page's "Invoice Date" field is labelled by two labels** ("Invoice Number Invoice Date").
  axe did not flag it.
- **The API is intermittently unavailable.** `POST /carts` returned 500 once in three tries during research. In the final run it returned 500, then redirected to a 404, for several minutes in a row.

## The live run and Cloudflare

From GitHub-hosted runners, Cloudflare in front of practicesoftwaretesting.com answers some
navigations with a managed bot challenge (`__cf_chl_rt_tk`) instead of the shop. The first live run
(4 browsers, one after the other) was hit on full page loads: sign-out, login redirects, language
reloads. Bot detection is not something a test suite should defeat, so the suite does not try.

- A test whose own navigation lands on the challenge is skipped with "Cloudflare bot challenge on the
  live site (not bypassed by design)".
- Any other test the challenge interrupts carries a `bot challenge` annotation, so its failure reads
  as environmental.
- The live run is limited to Chromium and mobile. That means fewer requests, and the other
  engines are covered on the self-hosted gate.

From a residential connection the live run is not challenged (the earlier local runs).

## Runs

Current results and their history: the [published Allure report](https://fgacic.github.io/qa-lab-playwright/)
(Graphs: Status dynamics, Durations dynamics, Status age pyramid). The
[merged Playwright report](https://fgacic.github.io/qa-lab-playwright/playwright/) is published alongside it.

| Run | Workflow | Result | Notes |
|---|---|---|---|
| [41776797960](https://github.com/fgacic/qa-lab-playwright/actions/runs/41776797960) | CI | failed | First run. Six chat contrast pins "passed" (scan timing), the merge job tripped on the visual container's path, an admin journey raced a form load. All fixed. |
| [41778285684](https://github.com/fgacic/qa-lab-playwright/actions/runs/41778285684) | CI | failed (1 job) | First publish to Pages. The admin edit journey also needed the image re-chosen (ADM-09). |
| [41779398991](https://github.com/fgacic/qa-lab-playwright/actions/runs/41779398991) | CI | passed | Every job green; trend history starts building. |
| [41780293737](https://github.com/fgacic/qa-lab-playwright/actions/runs/41780293737) | CI | passed | Chromium 366 passed (7 skipped); Firefox 295 passed (78 skipped); WebKit 294 passed, 1 flaky (78 skipped); account, admin and mobile 31 passed; visual 13 passed; verify-bugs: 72 of 72 pins still fail. |
| [41808661261](https://github.com/fgacic/qa-lab-playwright/actions/runs/41808661261) | CI | passed | Every job green. |
| [41780303630](https://github.com/fgacic/qa-lab-playwright/actions/runs/41780303630) | Live site | failed | 4 browsers; Cloudflare bot challenges (see above). |
| [41812346305](https://github.com/fgacic/qa-lab-playwright/actions/runs/41812346305) | CI | passed | Report #7: 1000 of 1000 passed, 0 skipped, 0 global errors (chromium 366, firefox 295, webkit 295, mobile 14, account 7, admin 8, setups 2, visual 13); Allure labels populate every graph. |
| [41808674880](https://github.com/fgacic/qa-lab-playwright/actions/runs/41808674880) | Live site | failed | Chromium and mobile: 330 passed, 29 skipped as challenged, 13 failed where the challenge hit background requests (translation files, app reloads). The same specs pass from a residential connection. |

**Scheduling.** Where a spec runs is decided in `playwright.config.ts` by tag, never by a runtime
skip:

| Project | Tests | Notes |
|---|---|---|
| chromium | 1457 | Everything except `@account`, `@admin`, `@visual`, `@perf`, `@framework` (own projects) and `@mobile` (phone only). |
| firefox, webkit | 626 each | The same, minus the Chromium-only `@axe`, `@i18n` and `@api`. |
| perf | 19 | `@perf` budgets (five pages and two phone loads), the page weights of home and a product, the layout-shift pins and their ratchets, the cart observation and the three collector controls (a long task, a slow click, a known document), alone: one worker, no parallelism, no retries. |
| mobile | 18 | `@smoke` and `@mobile` on a Pixel 7. |
| framework | 197 | `@framework`: the mock layer, the target configuration, the write guard and its teardown check, the answer gate (`holdAnswers`: a double click reaches a guarded handler once and an unguarded one twice, on each engine), the console guard (its own spec, the failed-request log in both its shapes included), the run guard, the lint configuration, the preflight and the health check, the Toolshop API helpers, the a11y ratchet's decision (`diffFindings`), the refusal to record the a11y baseline on CI, the custom matchers (`toBeSorted`, `toShowAmount` and the amount parser), the performance baseline arithmetic (`ratchetLimits`, noisy metrics, the margin cap, what counts as CI), the `test-all` runner, the security header matchers (`security/header-matchers`, offline), the pin verdicts and the orchestration of verify-bugs (it runs with `--max-failures=0`, so CI's stop after 30 failures cannot cut it short; a pin that passes once and reproduces on the rerun, a pin verified in each engine that schedules it, and the `--project` and `--skip-project` shards), and the defect-id check. No site is needed (the API-helper test uses the self-hosted shop; the `test-all` and `a11y-record` tests start a nested run and are `@self-hosted`). |
| account / admin | 7 / 20, plus one setup test each (8 / 21 listed) | Only exist when real sign-ins may run (always on the self-hosted shop). |
| visual | 31 (30 baselines and the orphan check) | Only inside the Playwright image. |

`@self-hosted` specs are never scheduled against the live site, `@live-only` specs only there. Before
this, those suites called `test.skip()` at file level, which allure-playwright records as a global
error ("skip modifier failed"). Report #6 showed 142 of them on a green run. A gate run now has no
skipped tests at all.
