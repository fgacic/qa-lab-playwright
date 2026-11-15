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

## Header and global navigation

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Logo / brand link back to home | link `/ - Toolshop$/` | – | yes | n/a | n/a | n/a | navigation/header | covered |
| Home, Contact, Sign in links | link by name in the menubar | – | yes | n/a | n/a | n/a | navigation/header | covered |
| Categories menu: Hand Tools, Power Tools, Other, Special Tools, Rentals | button "Categories", links by name | QUERY /products | yes | n/a | n/a | n/a | navigation/header | covered |
| Cart link with item count | `[nav-cart]` | GET /carts/{id} | yes | yes (absent when empty) | n/a | n/a | navigation/header | covered |
| Signed-out state (Sign in, no account menu) | link "Sign in", `[nav-menu]` | GET /users/me (401) | yes | yes | n/a | n/a | navigation/header | covered |
| Mobile menu toggle (< 992 px) | button "Toggle navigation" | – | yes | n/a | n/a | n/a | navigation/header (@mobile) | covered |
| Account menu: My account, favorites, profile, invoices, messages | `[nav-menu]`, links by name | – | yes | n/a | n/a | n/a | account/account-area | covered |
| Sign out | `[nav-sign-out]` | – | yes | n/a | n/a | n/a | account/account-area | bug found (A11Y-04) |
| Language switcher: list of 7 | button / menu "Select language" | – | yes | n/a | n/a | n/a | navigation/language | covered |
| Switch to de, el, en, es, fr, nl, tr | menuitem "DE"... | – | yes (×7) | n/a | n/a | n/a | navigation/language | covered |
| Language persists across reload and routes | `localStorage.language` | – | yes | n/a | n/a | n/a | navigation/language | covered |

## Routing

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| /account, /favorites, /profile, /invoices, /messages redirect to login when signed out | URL | GET /users/refresh | n/a | yes (×5) | n/a | n/a | navigation/routing | covered |
| /admin when signed out | URL | – | n/a | yes | n/a | n/a | navigation/routing | bug found (BUG-01) |
| Unknown route | URL, grid | – | n/a | yes | n/a | n/a | navigation/routing | bug found (BUG-02) |
| /compare is not a route (it is /comparison) | URL | – | n/a | yes | n/a | n/a | navigation/routing | covered |
| Admin area for a customer | URL | – | n/a | yes (redirected away) | n/a | n/a | admin/dashboard-and-menu | covered |
| Admin area | see [Back office](#back-office-admin) | | | | | | | |

## Banners and footer

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Notification bar "Documentation" link | link "Documentation" | – | yes (href, target) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Course promo "Explore courses" | link "Explore courses" | – | yes (href with UTM, target) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Footer: courses, API Spector, GitHub | links by name | – | yes (href, target, rel) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Footer: Privacy Policy reaches the privacy page | link "Privacy Policy" | – | yes (lands on /privacy) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Testing Guide: open, Next, Previous (disabled on step 1), Escape | button "Testing Guide", "Next →", "← Previous" | – | yes | yes | n/a | n/a | navigation/banners-and-footer | covered |
| Testing Guide "Mark as read" | checkbox "Mark as read" | – | – | – | – | – | – | blocked: a training aid outside the shop, with no visible effect beyond its own checkbox |
| "Bug Hunting" button | button "🐛 Bug Hunting" | – | – | – | – | – | – | blocked: opens a split-screen training panel; at 1280 px headless it rendered nothing visible to assert on |

## Product overview: search, sort, filters, pagination

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Product grid (cards: name, price, stock) | links with an h5 | QUERY /products | yes | n/a | yes (500, abort) | yes | catalog/filters | bug found (BUG-04) |
| Card image: alt text names the product | image by name | – | yes | n/a | n/a | n/a | catalog/filters | covered |
| Search by button and by Enter | textbox / button "Search" | QUERY /products/search `{q}` | yes | yes (no match) | yes | yes | catalog/search | bug found (BUG-03) |
| Search caption and result count | `[search-caption]`, `[search-result-count]` | – | yes | yes | n/a | yes | catalog/search | bug found (I18N-21: the caption is English in every language) |
| Search then sort, and filter then search: each keeps the other applied | textbox "Search", combobox "sort", filters | QUERY /products/search `{q}`, QUERY /products | yes (×2) | n/a | n/a | n/a | catalog/search, catalog/filters | covered |
| Search with special characters (`o'brien`, `100%`, `%%%`, `___`, `a&b=c`, `"quoted"`, `<b>x</b>`): sent as typed, shown as text | textbox "Search" | QUERY /products/search `{q}` | yes (×7) | n/a | n/a | n/a | catalog/search | covered |
| Search with padded terms: the term is sent as typed, the caption shows it | textbox "Search" | QUERY /products/search `{q}` | yes | n/a | n/a | n/a | catalog/search | covered |
| Search submitted empty or blank | textbox "Search", button "Search" | – | n/a | yes (empty: nothing sent) | n/a | n/a | catalog/search | bug found (BUG-34, a spaces-only term is sent and shown as "0 products found for ' '") |
| Search term under 3 characters | textbox "Search" | – | n/a | yes | n/a | n/a | catalog/search | bug found (BUG-35) |
| Search term over 40 characters | textbox "Search" | – | n/a | yes | n/a | n/a | catalog/search | bug found (BUG-27) |
| Search reset "X" | button "X" | QUERY /products | yes | n/a | n/a | n/a | catalog/search | covered |
| Sort: 6 options; page 2 continues the order of page 1 | combobox "sort" | QUERY /products `{sort}` | yes (×6, and page 2) | n/a | n/a | n/a | catalog/sort | covered |
| Category checkbox | checkbox by name | QUERY /products `{by_category}` | yes | n/a | yes | yes | catalog/filters | bug found (BUG-05) |
| Parent category ticks its subcategories | checkbox "Power Tools" | – | yes | yes (siblings stay unticked) | n/a | n/a | catalog/filters | covered |
| Brand checkbox | checkbox by name | QUERY /products `{by_brand}` | yes | n/a | yes | yes | catalog/filters | bug found (BUG-05) |
| Eco-friendly only | checkbox "Show only eco-friendly products" | QUERY /products `{eco_friendly}` | yes | n/a | n/a | n/a | catalog/filters | covered |
| Combined filters; untick restores | – | QUERY /products | yes | n/a | n/a | n/a | catalog/filters | covered |
| Price slider, max and min handles (a test moves both handles) | slider "ngx-slider-max" / "ngx-slider" | QUERY /products `{between}`, one per one-dollar step | yes (both) | yes (a late answer for an earlier step) | n/a | n/a | catalog/filters | bug found (BUG-30) |
| Mobile "Filters" fold-out | button "Filters" | – | yes | n/a | n/a | n/a | @smoke specs on the mobile project | covered |
| Pagination: Next, Previous, page number, last page; Previous and Next from a middle page | buttons "Next", "Previous", "Page-N" | QUERY /products `{page}` | yes | yes | n/a | yes (single page: no pagination) | catalog/pagination | covered |
| Pagination: the current-page marker (the `active` class on the list item) follows the page; a sort or filter change restarts at page 1 | list item around "Page-N" | QUERY /products `{page}` | yes | yes (the marker after a reset from a later page) | n/a | n/a | catalog/pagination | bug found (BUG-33) |
| Pagination end buttons disabled for assistive tech | button "Previous" | – | n/a | yes | n/a | n/a | catalog/pagination | bug found (A11Y-03) |

## Category pages and rentals

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| /category/hand-tools, power-tools, other | `[page-title]`, grid | QUERY /products `{by_category_slug}` | yes (×3) | n/a | yes | yes (special-tools) | catalog/category-pages | bug found (BUG-04) |
| A parent category's total equals the sum of its subcategories' | grid, API totals | QUERY /products `{by_category_slug}` | yes | n/a | n/a | n/a | catalog/category-pages | covered |
| Unknown category slug | `[page-title]` | QUERY /products | n/a | yes | n/a | n/a | catalog/category-pages | bug found (BUG-06) |
| Rentals list | heading "Rentals", `[product-<id>]` | QUERY /products `{is_rental}` | yes | n/a | yes | yes | catalog/rentals | bug found (BUG-07, BUG-08) |
| Rental detail (no quantity picker) | heading, button "Add to cart" | GET /products/{id} | yes | n/a | n/a | n/a | catalog/rentals | covered |

## Comparison

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Compare toggle on a card (aria-pressed); the selection survives navigation to another page | button "Compare" | – (sessionStorage) | yes | yes (toggle off) | n/a | n/a | catalog/compare | covered |
| Limit of 4 products | – | – | n/a | yes | n/a | n/a | catalog/compare | covered |
| Comparison bar: count, Clear All, Compare Now | `[comparison-bar]`, buttons by name | – | yes | n/a | n/a | n/a | catalog/compare | covered |
| Compare from the product page | button "Compare" | – | yes | n/a | n/a | n/a | catalog/compare | covered (no on-page feedback, see notes) |
| Comparison table rows (price, brand, category, availability, CO₂) | table "Product Comparison", rowheaders | POST /graphql | yes | n/a | yes | yes | catalog/compare | bug found (BUG-09) |
| Show differences only | checkbox "Show differences only" | – | yes | n/a | n/a | n/a | catalog/compare | bug found (BUG-12) |
| Remove one product; Clear All; Browse Products | buttons by name, link "Browse Products" | – | yes | yes (empty state) | n/a | n/a | catalog/compare | covered |

## Product detail

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Name, price, description, specs | h1, `[unit-price]`, `[product-description]`, table rows | GET /products/{id} | yes | n/a | yes (404, 500) | n/a | product/product-detail | bug found (BUG-11) |
| Quantity +/- (floor at 1; the + button stops at 99) | buttons "Increase/Decrease quantity", spinbutton "Quantity" | – | yes | yes (floor, ceiling) | n/a | n/a | product/product-detail | covered |
| Typed quantity 0, -1, empty, 2.5, > 99 | spinbutton "Quantity" | – | n/a | yes (×5) | n/a | n/a | product/product-detail | covered |
| Add to cart, toast, header count | button "Add to cart" | POST /carts, POST /carts/{id} | yes | n/a | yes (500, abort) | n/a | product/product-detail | bug found (BUG-10) |
| Add to favourites (signed out / in / duplicate) | button "Add to favourites" | POST /favorites | yes (mocked session) | yes (401, 422) | n/a | n/a | product/product-detail | covered |
| Related products | links with an h5 | GET /products/{id}/related | yes | n/a | yes (500: BUG-43) | yes | product/product-detail | bug found (BUG-43) |
| Out-of-stock state | text "Out of stock", disabled controls | – | n/a | yes | n/a | n/a | product/product-detail | covered |
| ECO badge | `[eco-badge]` | – | yes | n/a | n/a | n/a | product/product-detail | covered |

## Cart (checkout step 1)

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Lines: title, quantity, unit price, line total, cart total | table rows, `[line-price]`, `[cart-total]` | GET /carts/{id} | yes | yes (no cart) | yes (failed request: BUG-32) | yes | cart/cart | bug found (BUG-13, BUG-32) |
| Change quantity (the new quantity and totals are checked again after a reload) | spinbutton "Quantity for …" | PUT /carts/{id}/product/quantity | yes | yes (0, -1, empty, 2.5, > 99; the corrected value survives a reload) | yes | n/a | cart/cart | bug found (BUG-14, BUG-42: 2.5 is refused by the API with a 422, but the line keeps 2.5 and its total) |
| Remove a line; remove the last line (the line stays gone after a reload) | remove control (CSS, see A11Y-01) | DELETE /carts/{id}/product/{pid} | yes | n/a | yes | n/a | cart/cart | bug found (BUG-15, A11Y-01) |
| Eco discount 5% (eco-only cart), with literal expected amounts from a mocked cart | `[cart-subtotal]`, `[cart-eco-discount]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| Eco discount in a mixed eco and normal cart | – | – | – | – | – | – | – | gap: a mixed cart shows no eco discount at all; whether that is intended is unclear, so it is not pinned |
| Combination discount 15% (rental + product), "price per hour" | `[cart-discount]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| Continue Shopping, Proceed to checkout | buttons by name, `[proceed-1]` | – | yes | n/a | n/a | n/a | cart/cart | covered |

## Checkout steps 2–4

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Sign in / Continue as Guest tabs | tab by name | – | yes | n/a | n/a | n/a | checkout/sign-in-step | covered |
| Sign-in validation (empty, format, length) | labels, `[email-error]` | – | n/a | yes (×3) | n/a | n/a | checkout/sign-in-step | covered |
| Wrong credentials: the real failed login (self-hosted), and a mocked 401 twin that runs everywhere | `[login-error]` | POST /users/login (401) | n/a | yes (×2) | n/a | n/a | checkout/sign-in-step | covered (real: self-hosted) |
| Guest details, confirmation, proceed | labels, `[proceed-2-guest]` | – | yes | yes (empty, bad email) | n/a | n/a | checkout/sign-in-step | covered |
| Signed-in checkout (proceed without guest step) | `[proceed-2]` | POST /invoices | yes | – | – | – | account/real-account | covered (self-hosted) |
| Billing address, Proceed disabled until complete (also with an empty house number); changing the country after filling the address | labels, `[proceed-3]` | – | yes | yes | n/a | n/a | checkout/billing-step | covered |
| Billing: a malformed postcode is explained and Proceed stays disabled | labels, `[proceed-3]` | GET /postcode-lookup (mocked) | n/a | yes | n/a | n/a | checkout/billing-step | bug found (BUG-40) |
| Billing: answers arriving out of order; the address of the last house number is shown | labels | GET /postcode-lookup (mocked, one answer held back) | n/a | yes | n/a | n/a | checkout/billing-step | bug found (BUG-41) |
| Postcode lookup fills street / city / state | labels | GET /postcode-lookup | yes | yes (404) | yes (500) | n/a | checkout/billing-step | covered |
| Payment method list (5) | combobox "Payment Method" | – | yes | n/a | n/a | n/a | checkout/payment-step | covered |
| Fields per method: bank, card, BNPL, gift card; COD has none | labels | – | yes (×5) | n/a | n/a | n/a | checkout/payment-step | covered |
| Field validation with non-numeric junk (bank, card, gift card) | validation texts | – | n/a | yes (×3) | n/a | n/a | checkout/payment-step | covered |
| Credit card with empty fields | button "Check payment" | – | n/a | yes | n/a | n/a | checkout/payment-step | bug found (BUG-16) |
| BNPL: plans of 3, 6, 9 and 12 months; the check is disabled until one is chosen | select "Monthly Installments" | – | yes (every target) | yes (self-hosted pin) | n/a | n/a | checkout/payment-step | bug found (BUG-29, self-hosted build) |
| Check payment → Confirm | `[payment-success-message]`, `[payment-error-message]` | POST /payment/check | yes | yes (400 declined) | yes (500) | n/a | checkout/payment-step | covered |
| Place order and confirmation (invoice number) | text "Thanks for your order! …" | POST /invoices/guest | yes | n/a | yes (500, 422) | n/a | checkout/payment-step, purchase-flow | bug found (BUG-17) |
| Card, bank and gift-card payments with real-looking numbers | – | POST /payment/check | – | – | – | – | – | blocked: the suite never types card, bank or gift-card numbers, not even fake ones |

## Purchase flows (@flow)

Add to cart and cart edits create **anonymous carts**, on the live site too: an accepted arrange write
(the write guard lets exactly these through). Placing an order does not, so it is `@self-hosted`.

| Flow | API calls | Spec | Status |
|---|---|---|---|
| Browse → product → cart → guest → billing → payment step (writes only an anonymous cart; the live-safe smoke) | POST /carts, /carts/{id} | checkout/purchase-flow | covered |
| Edit the cart: search ×3 → three products → change a quantity → remove a line; line prices from the API (anonymous carts, runs everywhere) | POST /carts, /carts/{id}, PUT, DELETE | checkout/purchase-flow | covered |
| Browse → product → quantity 2 → cart → guest → billing → Cash on Delivery → invoice number, cart emptied. A real `@self-hosted` test, and a mocked twin that runs everywhere | POST /carts, /carts/{id}, /payment/check, /invoices/guest | checkout/purchase-flow, checkout/payment-step | covered (self-hosted: places an order; the twin is mocked) |
| Order what the cart shows: the invoice total is the cart total, and the billing city is the city on screen | as above | checkout/purchase-flow | covered (self-hosted: places an order) |
| Signed-in purchase appears on the customer's invoices | POST /invoices, GET /invoices | account/real-account | covered (self-hosted) |

## Login, registration, password reset

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Login validation (empty, format, length) and no request sent | labels, `[email-error]`, `[password-error]` | – | n/a | yes | n/a | n/a | auth/login | covered |
| Unknown credentials: a real `@self-hosted` test and a mocked twin that runs everywhere | `[login-error]` | POST /users/login (401) | n/a | yes (×2) | n/a | n/a | auth/login | bug found (I18N-22: "Invalid email or password" is English in every language) |
| Successful login → account, signed-in header | – | POST /users/login, GET /users/me (mocked) | yes | n/a | yes (500, abort, 423 locked) | n/a | auth/login | covered |
| Two-factor (TOTP) step, empty code and a wrong code | textbox "TOTP Code", button "Verify TOTP" | POST /users/login (mocked) | yes | yes (×2) | n/a | n/a | auth/login | covered |
| Show/hide password | unnamed button | – | yes | n/a | n/a | n/a | auth/login, auth/register | bug found (A11Y-02) |
| Register / Forgot password links | links by name | – | yes | n/a | n/a | n/a | auth/login | covered |
| Sign in with Google | button "Sign in with Google" | – | yes (present) | – | – | – | auth/login | blocked: starts a real third-party OAuth flow; presence only |
| Registration: 12 required fields | labels, `[<field>-error]` | – | n/a | yes | n/a | n/a | auth/register | covered |
| Registration: date, phone, email, password formats | labels | – | n/a | yes (×5) | n/a | n/a | auth/register | covered |
| Registration: future date of birth | `[dob-error]` | – | n/a | yes | n/a | n/a | auth/register | bug found (BUG-18) |
| Registration: password rules, reveal (the page says at least 8 characters, the validation message "minimal 6") | list items, unnamed button | – | yes | yes (the two disagree) | n/a | n/a | auth/register | bug found (BUG-31) |
| Registration: postcode lookup | labels | GET /postcode-lookup (mocked) | yes | n/a | n/a | n/a | auth/register | covered |
| Registration submit: body, redirect to login | – | POST /users/register (mocked 201) | yes | yes (422 duplicate) | yes (500) | n/a | auth/register | covered |
| Registration → login → account area | – | mocked register, login, me | yes | n/a | n/a | n/a | auth/registration-flow | covered |
| Same journey against the real API; duplicate email | – | real | yes | yes | – | – | account/real-account | covered (self-hosted) |
| Forgot password: empty, malformed, unknown email (the unknown email is a real `@self-hosted` test with a mocked twin) | `[email-error]`, alert | POST /users/forgot-password (422) | n/a | yes (×4) | n/a | n/a | auth/forgot-password | bug found (BUG-19) |
| Forgot password: accepted / failed | – | POST /users/forgot-password (mocked) | yes | n/a | yes | n/a | auth/forgot-password | bug found (BUG-20, also pinned in the translation suite as I18N-23: the same defect, counted once) |

## Account area

Mocked session (fake JWT + mocked `GET /users/me`) unless marked gated.

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Account page tiles to four sections | `[nav-favorites]`... | – | yes | n/a | n/a | n/a | account/account-area | covered |
| Favorites list and remove | `[favorite-<id>]`, `[delete]` | GET /favorites, DELETE /favorites/{id} | yes | n/a | yes | yes | account/account-area | bug found (BUG-23) |
| Invoices list and invoice details | table rows, link "Details" | GET /invoices, GET /invoices/{id} | yes | n/a | yes | n/a | account/account-area | bug found (BUG-24) |
| Invoice "Download PDF" | button "Download PDF" | GET /invoices/{n}/download-pdf | yes (present) | – | – | – | account/account-area | blocked: the PDF is generated asynchronously by the real backend; mocking it would only test the mock |
| Messages list, details, reply | rows, link "Details", textbox "Message" | GET /messages, GET /messages/{id}, POST /messages/{id}/reply | yes | n/a | n/a | yes | account/account-area | covered |
| Profile prefilled, update (the email is read-only) | labels, button "Update Profile" | GET /users/me, PUT /users/{id} | yes | yes (empty first name, malformed phone) | yes (422 on PUT /users/{id}) | n/a | account/account-area | covered |
| Change password: success feedback, empty form | textboxes by name, button "Change Password" | POST /users/change-password | yes (success feedback) | yes (empty form; 400 from the API) | n/a | n/a | account/account-area | bug found (BUG-26) |
| Profile TOTP setup | `[totp-secret]`, `[verify-totp]` | POST /totp/setup | – | – | – | – | – | blocked: enrolling 2FA needs a real authenticator secret from the real backend |
| Real session from storageState; per-worker account favorites | – | real | yes | – | – | – | account/real-account | covered (self-hosted) |

## Contact

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Subjects (6) | combobox "Subject" | – | yes | n/a | n/a | n/a | contact/contact | covered |
| Required fields (5) | labels, `[<field>-error]` | – | n/a | yes | n/a | n/a | contact/contact | covered |
| Email format, message < 50 characters | labels | – | n/a | yes (×2) | n/a | n/a | contact/contact | covered |
| Attachment: not empty, not .txt, empty .txt accepted | "Attachment", `[attachment-error]` | – | yes | yes (×2) | n/a | n/a | contact/contact | covered |
| Send: request body and confirmation | button "Send", alert | POST /messages | yes (real on self-hosted, fake example.com sender; mocked 201 on every target) | n/a | yes (500, 422, abort) | n/a | contact/contact | bug found (BUG-21, BUG-22) |

## Widgets

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Chat: open, greeting, menu, close | buttons "Open chat", "Close chat" | – | yes | n/a | n/a | n/a | widgets/chat | covered |
| Chat: Find a product (product cards, mocked) | textbox "Message", button "Send message", `[chat-product]` | QUERY /products/search | yes | n/a | yes | yes | widgets/chat | bug found (BUG-25) |
| Chat: Order a product, Checkout (empty cart), Back to menu (appends a second greeting and menu) | buttons by name | – | yes | yes | n/a | n/a | widgets/chat | covered |
| Chat: support ticket (name, email, subject, message, skip attachment); email and message-length validation | buttons and textbox | POST /messages (mocked) | yes | yes (×2) | n/a | n/a | widgets/chat | covered |
| Chat: file attachment | `[chat-file-input]` | – | – | – | – | – | – | blocked: only reachable at the end of the ticket flow; the upload goes to the real messages API |
| Live activity: open, counters, the "Live" state while the feed is connected, close | button "Show live shop activity", `[live-activity-*]` | GET /sales-stream (SSE, mocked) | yes | n/a | n/a | yes | widgets/live-activity | covered |
| Live activity: feed unreachable; the feed drops, then reconnects | `[live-activity-*]` | GET /sales-stream (SSE, mocked) | n/a | n/a | yes (unreachable, drop then reconnect) | n/a | widgets/live-activity | covered |
| Live activity: incoming sales listed, totals add up | `[live-activity-item]` | GET /sales-stream (mocked) | yes | n/a | n/a | n/a | widgets/live-activity | covered |

## Back office (admin)

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
| Product form: brand, category and image preselected when editing | combobox "Brand", "Category" | GET /products/{id} | n/a | yes | n/a | n/a | admin/catalog-admin | bug found (ADM-09) |
| Dashboard: sales chart, orders awaiting fulfilment, Edit; a healthy dashboard shows no alert (watched over a time window) | heading, `canvas`, table | GET /invoices?in=status,…, GET /reports/total-sales-of-years | yes | n/a | yes | yes | admin/dashboard-and-menu | bug found (ADM-01) |
| Lists: products, brands, categories, orders, users, messages (an empty list shows no alert, watched over a time window) | heading, table rows | QUERY /products, GET /brands, /categories, /invoices, /users, /messages | yes (×6) | n/a | yes (×6) | yes (×6) | admin/* , admin/lists-failures | bug found (ADM-07) |
| List paging: the second page of products and of orders is requested and replaces the first | pagination buttons | QUERY /products `{page}`, GET /invoices `?page=` | yes (×2) | n/a | n/a | n/a | admin/lists-failures | covered |
| List search (products, brands, categories, orders, users) and reset (products) | textbox "Search …", buttons | QUERY /…/search `{q}` | yes (×6) | n/a | n/a | n/a | admin/catalog-admin, orders-users-messages | covered |
| Delete (products, brands, categories, users; `AdminTable.delete` answers a confirm dialog if one opens) | button "Delete" | DELETE /{entity}/{id} | yes (×4) | yes (product in use, brand in use: 409, the reason is shown) | n/a | n/a | admin/catalog-admin, orders-users-messages | bug found (ADM-02, pinned once per list: products, brands, categories, users) |
| Product form: add, required fields, CO₂, brand, category, image | labels | POST /products | yes | yes (required, text price, negative price) | yes (422) | n/a | admin/catalog-admin | bug found (ADM-03, ADM-04) |
| Product form: edit prefilled, save | labels | GET /products/{id}, PUT /products/{id} | yes | n/a | n/a | n/a | admin/catalog-admin | bug found (ADM-05) |
| Edit forms whose record fails to load (product, brand, user: 500) | labels, alerts | GET /products/{id}, /brands/{id}, /users/{id} | n/a | n/a | yes (×3) | n/a | admin/catalog-admin, admin/orders-users-messages | bug found (ADM-14: the form opens empty, with no message) |
| Product specifications: list, add, remove | `[specs-table]`, `[spec-name]`… `[add-spec]`, button "×" | GET/POST/DELETE /products/{id}/specs | yes | n/a | n/a | n/a | admin/catalog-admin | covered |
| Brand form: add, edit, required name and slug; a save the API refuses (409) | labels, `[name-error]`, `[slug-error]` | POST /brands, PUT /brands/{id} | yes | yes (409 refused) | n/a | n/a | admin/catalog-admin | bug found (ADM-12) |
| Category form: add under a parent, edit, required fields; a save the API refuses (409) | combobox "Parent Id", labels | POST /categories, PUT /categories/{id} | yes | yes (409 refused) | n/a | n/a | admin/catalog-admin | bug found (ADM-12) |
| Order: invoice, payment, billing, lines | textboxes by label, table | GET /invoices/{id} | yes | n/a | yes (500) | n/a | admin/orders-users-messages | bug found (ADM-13: a failed load says "This invoice doesn't exist.") |
| Order: update status (every status other than the current one, which cannot be reselected) | combobox "Status", button "Update status" | PUT /invoices/{id}/status | yes | n/a | yes (500, "not saved" shown) | n/a | admin/orders-users-messages | covered |
| User form: add (required fields; a new user is saved with what was entered), edit incl. Enabled and failed attempts; the password field is masked | labels | POST /users/register, PUT /users/{id} | yes (add, edit) | yes (required, email taken 422, a 422 on create) | n/a | n/a | admin/orders-users-messages | bug found (ADM-17: the password field is `type="text"`) |
| Message: read, status on change, reply (the reply is shown under the message and the box emptied) | combobox "Status", textbox "Reply message" | GET /messages/{id}, PUT …/status, POST …/reply | yes (reply confirmation) | yes (empty reply) | yes (a failed reply, a failed status save: neither is reported) | n/a | admin/orders-users-messages | bug found (ADM-06, ADM-10, ADM-11) |
| Statistics: 4 report tables | headings, tables | GET /reports/top10-…, customers-by-country, total-sales-per-country | yes | n/a | yes | yes | admin/reports-and-settings | bug found (ADM-15: failed requests leave empty tables with no message) |
| Average sales per month / week: year picker, chart | combobox "Select year", `canvas` | GET /reports/average-sales-per-{month,week}?year= | yes (×2) | yes (current year) | n/a | n/a | admin/reports-and-settings | bug found (ADM-08) |
| Settings: payment endpoint, geolocation (persists after a reload), CO₂ features, eco badge, save, clear storage; a non-URL endpoint | labels, buttons | – (localStorage) | yes | yes (non-URL endpoint) | n/a | n/a | admin/reports-and-settings | bug found (ADM-16: a non-URL endpoint is accepted and "Settings saved!" is shown) |
| Settings take effect in the shop (CO₂ sort hidden) | combobox "sort" | – | yes | n/a | n/a | n/a | admin/reports-and-settings | covered |
| Order "add" route (/admin/orders/add) | – | – | – | – | – | – | – | blocked: no page links to it, and the API has no endpoint for an admin to create an order |
| Real: product create → sold in the shop → repriced → deleted (the product is a rental, so the shop's default list never shows it to parallel specs, and the `createdProducts` fixture deletes it by its id in teardown, pass or fail; guest orders and contact messages cannot be deleted through the API and stay on the throwaway database) | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: a product with a short word in its name is found by full-name search | as above | QUERY /products/search | n/a | yes | – | – | admin-e2e/back-office.e2e | bug found (BUG-28) |
| Real: a guest order (placed through the API) marked as shipped | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: a contact message (sent through the API) read and taken in progress | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |
| Real: statistics and monthly chart render from real data | as above | real | yes | – | – | – | admin-e2e/back-office.e2e | covered (self-hosted) |

## Accessibility

An axe-core scan (`@axe-core/playwright` 4.14.0, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa`) of 40 pages and states, in `tests/a11y` (`npm run test:a11y`):

- **Shop:** home, search results, empty search, product (in stock, out of stock), category, rentals,
  comparison, and the cart with items (9).
- **Checkout:** sign-in, guest step with errors, billing, payment (4).
- **Forms and other pages:** login with errors, register with errors, forgot password, contact with
  errors, chat open, privacy, unknown route (7).
- **Account (mocked session):** 5 pages.
- **Back office (mocked admin):** 15 pages and forms.

Every scan first waits for a ready step (the element the page is about, named in `anchors`), so axe never runs on a half-rendered page, and the scan names come from one shared `ScanName` type. AX-04 and AX-10 are scanned in the states where they appear (login and registration with their errors shown). The element counts of AX-11 and AX-13 follow the shop's seed data, so they are compared exactly only on the self-hosted shop; elsewhere the violation must still be found where it was recorded and nowhere else. Every baseline id has a pin, and a test fails if one has none.

The full axe result of each scan is attached to the report, and so is the count of its `incomplete`
results (what axe could not decide), so a rule that goes quiet for lack of evidence is visible.

- **Scope.** The training-aid bar ("Testing Guide", "Bug Hunting") and its guide panel are excluded,
  because they are laid over the shop for testers and are not part of it. Everything else is
  scanned, the chat and live-activity widgets included.
- **Baseline, a ratchet.** A scan fails on a violation outside `src/support/a11y-baseline.ts`, so it
  catches regressions. A known violation is matched by rule, element and page, and carries the
  number of elements it was recorded with: the same violation on another page, or on more elements,
  fails, and so does one that shrinks or is gone from a page it was recorded on, until the baseline
  is updated. A fix therefore cannot go unrecorded. Each one (`nth-child` indices removed) has its own `knownBug` pin, anchored on
  the offending element, that turns red when it is fixed.
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
| bug found (AX-01..AX-13) | 40 | 13 | 6 | 7 | 0 | 0 |

## Visual regression

Chromium at 1280×800 with animations off. The baselines are recorded and compared only inside
`mcr.microsoft.com/playwright:v1.64.1-noble` (`npm run test:visual` / `test:visual:update`), against the
freshly seeded self-hosted shop (two workers), so fonts, data and pixels match on every machine. A colour counts as different from `threshold: 0.1` (Playwright's default is 0.2; 0.1 flags a real colour change and ignores anti-aliasing), and a screenshot may
differ by at most 150 such pixels, an absolute budget, so a changed price or word fails even on a tall page.
Locale, time zone, colour scheme and reduced motion are pinned. Masked: the product id on the admin form, the price
slider, related products (the API picks them), the generated guest email, and the dashboard's canvas
chart, which animates outside CSS. *Self-hosted only.*

| Page / state | Baseline | Spec | Status |
|---|---|---|---|
| Home, product, product out of stock, category, rentals | `home.png`, `product.png`, `product-out-of-stock.png`, `category.png`, `rentals.png` | visual/pages.visual | covered (self-hosted) |
| Contact, login and registration with errors | `contact-errors.png`, `login-errors.png`, `register-errors.png` | visual/pages.visual | covered (self-hosted) |
| Cart with a product, checkout billing and payment steps | `cart.png`, `checkout-billing.png`, `checkout-payment.png` | visual/pages.visual | covered (self-hosted) |
| Chat open | `chat.png` (the chat window only) | visual/pages.visual | covered (self-hosted) |
| Account page (mocked session), admin dashboard, product form, orders list and an order (mocked admin) | `account.png`, `admin-dashboard.png`, `admin-product-form.png`, `admin-orders.png`, `admin-order.png` | visual/pages.visual | covered (self-hosted) |
| Every baseline on disk belongs to a screenshot in the spec, whichever quoting style names it (an orphaned file fails) | – | visual/pages.visual | covered (self-hosted) |

17 baselines, 18 tests.

## Translations (i18n)

Twenty-eight visits, in all 7 languages, each sampled only once the page's own content (a heading, a
form, the product grid) has rendered, and each starting from an explicit language:

- home, search without results, product, product with a toast, an unknown product, category, rentals, empty comparison, comparison with products, the
  empty cart and the cart with a product;
- checkout billing, checkout payment and the order confirmation;
- contact, login and registration, each with their validation errors shown, and login refused;
- forgot password, and forgot password sent;
- privacy policy, pinned as a whole (I18N-06);
- the signed-in account pages (account, favorites, invoices, messages, profile);
- the chat open, and the language menu open.

The scan reads visible text and the text a user gets in other ways: `<title>`, `placeholder`,
`aria-label`, `title`, `alt`, button values, and the options of every list, the menus' items included. The product card is scanned too, except its name, price and image (shop data).

A page fails on a leaked translation key (dotted, like `nav.home` or `page.x.y`; the detector also catches keys in attributes and mixed case). It also fails on text identical to
the English rendering of the same page, except:

- the shop's data (product, brand and category names, descriptions, prices);
- the training-aid bar and the build line;
- words a language shares with English ("Contact" in French and Dutch, "Home" in Dutch).

Each known item is excluded only in the languages it was pinned in: the language guard is applied per
language, so I18N-08 (the logo's tooltip) is German and French only, and I18N-19 (the card form) German only. The known items live in `src/support/i18n-baseline.ts` (`KNOWN`), and each is pinned once per language it covers: 135 pin tests across 24 ids.

Chromium only: translation files do not depend on the engine.

| Check | Spec | Status |
|---|---|---|
| No leaked keys (28 visits × 7 languages) and no stray English (28 visits × 6 languages), one test per visit and language | i18n/completeness | covered (with the known items below excluded) |
| The key detector itself, on real page text (no false positives on emails, URLs, prices, abbreviations) | i18n/translation-keys | covered |
| Untranslated areas, one pin per id and language | i18n/completeness | bug found (I18N-01..24) |
| The forgot-password confirmation shows its raw key (I18N-23 is BUG-20 seen here: two pins, one defect, counted once) | auth/forgot-password, i18n/completeness | bug found (BUG-20, I18N-23) |

## Security (UI)

Payloads (`<img src=x onerror=…>`, `<script>…</script>`, an attribute breakout with `<svg onload=…>`)
are typed as plain text. Each payload, if it ran, would call a function the sentinel exposes to the
page, and the sentinel also wraps `alert`, `confirm` and `prompt`, so execution is seen with or
without a dialog. It is installed before the first navigation. After an action the spec waits for
images and timers to settle, then watches for a documented 1 s window, checks that no injected
element exists, and that the payload comes back as text. A positive control injects each payload
into a page the way a vulnerable sink would and proves the sentinel catches it. It has a control for
every payload (the three attacks, and their tagged-template forms for the address bar), for the
element each one leaves behind, and for a dialog opened in the page, in a popup the page opened
and in a tab of its own, so a payload that runs anywhere in the browser context is seen. The payloads stay under 40
characters, because the search drops longer terms (BUG-27).

| Input | Where it is shown | Target | Spec | Status |
|---|---|---|---|---|
| Search box (3 payloads) | search caption | both (read-only) | security/xss-reflected | covered |
| Chat "Find a product" (3 payloads) | chat transcript | both (read-only) | security/xss-reflected | covered |
| Contact message (API) | admin inbox list and message page | self-hosted only | security/xss-stored | covered (self-hosted) |
| Brand name (admin form) | admin brand list | self-hosted only | security/xss-stored | covered (self-hosted) |
| First name at registration | header account menu after login | self-hosted only | security/xss-stored | covered (self-hosted) |
| Contact form submission (guest, script tag included) | admin inbox | self-hosted only | security/xss-stored | covered (self-hosted) |
| Route segment `/category/<payload>` (3 payloads, as tagged templates) | the page title: echoed, title-cased | both (read-only) | security/xss-reflected | covered |
| Route segment `/product/<payload>` (3 payloads) | not echoed (nothing is shown of the id); must still not run | both (read-only) | security/xss-reflected | covered |
| The sentinel itself (a control for every payload and its injected element, a dialog in the page, in a popup and in a tab, and an inline script that calls `alert` while the page loads, which proves the sentinel is installed before any page script) | – | both | security/xss-sentinel | covered |
| Response headers: CSP, X-Frame-Options or CSP frame-ancestors, `nosniff`, Referrer-Policy, HSTS max-age, Server (real values judged by matchers, not presence; a Cloudflare challenge skips instead of satisfying a pin) | – | live only (headers belong to the deployment) | security/headers | bug found (SEC-01..06) |
| Cookie flags (Secure, HttpOnly, SameSite), CORS with credentials from an unknown origin, Permissions-Policy for camera, microphone and geolocation (checks, not pins: a red nightly run is the finding) | – | live only | security/headers | covered |
| Authorisation of the API: 401 without a token on `/users/me`, `/invoices`, `/favorites`, `/messages`, `/users`; 403 for a customer on the admin endpoints (users, three reports); another customer's invoice and account refused; DELETE of brands, categories and products refused | – | self-hosted only | security/authorization | covered (self-hosted) |
| Authorisation of the catalogue writes: create and update of a brand, category and product refused to an anonymous caller and to a customer | – | self-hosted only | security/authorization | bug found (SEC-07 brands, SEC-08 categories, SEC-09 products) |

The header checks are soft: they are defence in depth, not functional defects, and the shop is a
training site. They are pinned so that a header appearing turns the live run red.

The authorisation specs write to our own database, so they run on the self-hosted shop only. Every record they make is created under a unique "Qa Lab Authz …" name through the admin's token and removed in teardown, pass or fail. Products are created as rentals, which the shop's default list never shows, so a record that exists for a moment cannot disturb the catalogue specs running in parallel.

## Performance

Measured with the browser's own PerformanceObserver entries (Chromium only: WebKit has no LCP,
layout-shift or longtask entries):

- LCP is the last largest-contentful-paint before input;
- CLS is the sum of shifts without recent input;
- TBT is the long-task time above 50 ms, counted only for tasks before the first input (the cost of loading, not of the interaction);
- the INP proxy is the longest event duration of the interactions the test makes.

The thresholds are Core Web Vitals "good" limits: LCP 2.5 s, CLS 0.1, INP 200 ms, and Lighthouse's
200 ms for TBT. Every measurement is attached to its test. *Self-hosted only:* live numbers would
measure Cloudflare and the network, not the shop.

How it is measured, so the numbers mean something:

- in a `perf` project of its own, one worker, nothing else running;
- 4× CPU throttling and a 40 ms, 10/5 Mbps network (a mid-range phone on a good connection), cache off, so every sample is a cold load;
- the median of 5 fresh page loads per budget;
- a test fails if no LCP or no interaction was observed, so an empty measurement can never pass;
- a run that schedules `perf` next to another project is refused by the run-guard reporter;
- a control test runs a known 150 ms task before any interaction and requires the blocking time to count at least 100 ms of it, so the zeros reported for TBT mean "no long task" and not "observer asleep". (A task blocking inside `page.evaluate` is not reported as a long task by the browser, so the control runs it from a timer.)

**Baseline limit, per environment.** The absolute budgets above only catch a gross regression, so each
budget also has a limit relative to a recorded baseline: the median plus a margin of the largest of 3 times the spread seen across the 5 samples when it was recorded, 5% of the median, and a noise
floor (LCP 100 ms, CLS 0.02, TBT 50 ms, INP proxy 32 ms; see `fixtures/performance.ts`). `tests/performance/baseline.json` holds
the medians and spreads in one set per environment: `ci` when `CI` is set, otherwise `local`, keyed by CPU model and core count (here "local (Apple M3 Pro, 12 cores)"), because medians
recorded on one machine mean nothing on another. The baseline is enforced only when an entry for the
current environment exists. When none does, the test attaches the measured medians with an annotation saying so (on CI also a workflow warning), and the absolute budgets still apply. The baseline covers the LCP, TBT and INP of the five budget pages and the CLS of the four slow-API pages, the PERF-01 pages included: their CLS is ratcheted so a pinned page cannot get worse either.
- `local`: `UPDATE_PERF_BASELINE=1 npx playwright test --project=perf --workers=1`, on an idle machine
  (load average under 4). Recording is refused above that load and from a run that failed.
- `ci`: run the CI workflow by hand with the `record_perf_baseline` input. The `record-perf-baseline`
  job records it on a runner and uploads `baseline.json` as the `perf-baseline-ci` artifact; committing
  it back is a human step.

Medians of 5 on the self-hosted shop, `local` baseline (recorded at a load average of 2.2 to 3.4): LCP 1.04–1.26 s (home 1224, search 1224, product 1260, cart 1044, contact 1044 ms), INP proxy
16–32 ms, TBT 0. TBT stays at 0 even throttled (the first load has no long task above 50 ms), so that
budget is weak on this app; the control above is what shows the collector would see one. CLS on the 500 ms API: home 0.258, product 0.316, contact 0.17, cart 0.107.

| Page and interaction | LCP / TBT / INP | CLS (500 ms API) | Spec | Status |
|---|---|---|---|---|
| Home, filter click | within budget | 0.26 | performance/budgets | bug found (PERF-01) |
| Search for a term | within budget | – | performance/budgets | covered |
| Product: quantity, add to cart | within budget | 0.30–0.38 | performance/budgets | bug found (PERF-01) |
| Cart: proceed to sign in | within budget | 0.107 (the same in every sample): held to a fixed 0.13 ceiling and to its baseline, not pinned | performance/budgets | covered (observation) |
| Collector control: a known 150 ms task is counted as blocking time | – | – | performance/budgets | covered |
| Contact: submit empty | within budget | 0.17 | performance/budgets | bug found (PERF-01) |

PERF-01 pins home, product and contact only (CLS 0.17 to 0.38). The cart's 0.107 is the same footer
shift sitting a hair over the 0.1 line, so a different font render could pass it "fixed" without anyone
touching the shop; a pin that noise can flip cannot tell a fix from luck. It is measured, kept under a fixed ceiling (0.13, `CART_CLS_CEILING`) that holds on every environment, kept to its own
baseline where one is recorded so it cannot get worse, and carries no `@bug` tag.

**Why CLS is measured on a slow API.** The footer is painted before the routed page has its data,
then pushed down. At full speed, whether a run catches that depends on whether the first paint beats
the API: 0 to 0.32 across repeats, which would make the budget flaky. With 500 ms of API latency, a
realistic mobile figure, the shift happens every time (12 of 12 runs).

## Bugs found

Every entry below was reproduced by the suite. The pinned test states the behaviour the shop should have
and is wrapped in `knownBug()` (`test.fail`): it passes while the bug exists and fails the day it is
fixed. `npm run test:verify-bugs` runs every `@bug` test as an ordinary test, in whichever project schedules it, and checks that each fails for its own reason: the first error names the pin's id, is an assertion, and comes from the spec. The perf pins run in a pass of their own; the `@live-only` pins (SEC-01..06) are listed as not verifiable on the self-hosted target.

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
| BUG-26 | Profile | "Change Password" with every field empty is sent to the API instead of being validated in the form. | account/account-area |
| BUG-27 | Search | A search term over 40 characters is silently ignored: no request, no message. | catalog/search |
| BUG-28 | Search | A full-name search finds nothing when the name has a word under 3 letters (every word is required, MariaDB's full-text index drops short ones). | admin-e2e/back-office.e2e (self-hosted) |
| BUG-29 | Payment | Buy Now Pay Later: "Check payment" is enabled before a plan is chosen, and checking answers "Unknown error". Seen on the self-hosted build in all three engines; the live deployment disables the button. | checkout/payment-step (self-hosted) |
| BUG-30 | Filters | Every one-dollar step of the price slider sends its own request, none is cancelled, and the grid shows whichever answer arrives last. A slow answer for an earlier step replaces the final filter: products below the chosen minimum stay listed. Found as a flaky test under load, then reproduced by holding one answer back. | catalog/filters |
| BUG-31 | Registration | The page lists "at least 8 characters" for the password; the validation message says "minimal 6 characters long". | auth/register |
| BUG-32 | Cart | A failed cart request shows only the step header: no lines and no message. (Split from BUG-13.) | cart/cart |
| BUG-33 | Pagination | After a sort or filter change from a later page, the list restarts at page 1 but the pager still marks the old page as current, or none. | catalog/pagination |
| BUG-34 | Search | A search of only spaces is sent and shown as "0 products found for ' '"; an empty one sends nothing. | catalog/search |
| BUG-35 | Search | A search term under 3 characters is silently ignored: no request, no message. | catalog/search |
| BUG-40 | Billing | A postcode the lookup refuses as malformed is explained, but Proceed stays enabled once the rest of the address is typed. | checkout/billing-step |
| BUG-41 | Billing | Each change of the house number sends its own address lookup and the page applies whichever answer arrives last, so a slow answer for an earlier number overwrites the address of the final one. | checkout/billing-step |
| BUG-42 | Cart | A quantity of 2.5 is refused by the API (422), but the line keeps 2.5 and its total. | cart/cart |
| BUG-43 | Product page | A failed related-products request (500) leaves the "Related products" heading over nothing, with no message. | product/product-detail |

BUG-36 to BUG-39 were never assigned.

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
| ADM-02 | All lists | Delete acts on the first click, with no confirmation. Pinned once per list (products, brands, categories, users). | admin/catalog-admin |
| ADM-03 | Product form | Any price is sent to the API unvalidated: text ("abc") and negative ("-5") alike. | admin/catalog-admin |
| ADM-04 | Product form | "Quantity is required" stays on screen next to "Product saved!" although Stock is filled in. | admin/catalog-admin |
| ADM-05 | Product form | The edit form does not load the stock, so saving an existing product is blocked by "Quantity is required" until it is retyped. | admin/catalog-admin |
| ADM-06 | Messages | An empty reply is sent to the API (`{"message":""}`) instead of being validated. | admin/orders-users-messages |
| ADM-07 | All lists | A failed list request shows an empty table and no message, in every section. | admin/lists-failures |
| ADM-08 | Sales reports | The year picker stops at 2025 and opens on it; the current year cannot be chosen. | admin/reports-and-settings |
| ADM-09 | Product form | Editing leaves Brand, Category and Image empty (the API sends `brand` / `category` / `product_image` objects, the form expects `*_id` fields), so saving is blocked, without a message, until all three are chosen again. Confirmed against the real backend. | admin/catalog-admin |
| ADM-10 | Messages | A failed reply (500) is not reported: no message, and the typed text stays in the box. | admin/orders-users-messages |
| ADM-11 | Messages | A failed message status save (500) is not reported: the picker keeps showing the new status. | admin/orders-users-messages |
| ADM-12 | Brand and category forms | A save the API refuses (409, slug taken) is not reported: no message, nothing happens. | admin/catalog-admin |
| ADM-13 | Order page | An order whose load fails (500) shows "This invoice doesn't exist.", the message for a missing one. | admin/orders-users-messages |
| ADM-14 | Edit forms | An edit form whose record fails to load (product, brand, user) opens empty, with no message: saving it would write blanks. | admin/catalog-admin, admin/orders-users-messages |
| ADM-15 | Statistics | Failed statistics requests show empty tables with no message. | admin/reports-and-settings |
| ADM-16 | Settings | A non-URL payment endpoint is accepted and "Settings saved!" is shown. | admin/reports-and-settings |
| ADM-17 | User form | The password field is `type="text"`: the password is shown in clear text. | admin/orders-users-messages |

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
| I18N-16 | The page titles (browser tab) of checkout, login, register, forgot password, contact, privacy, comparison and rentals, and of the account pages. | i18n/completeness |
| I18N-17 | The cart link's aria-label, "cart" (an internal id). | i18n/completeness |
| I18N-18 | The cart lines' label "Quantity for …". | i18n/completeness |
| I18N-19 | The credit-card form's labels, hints and placeholders (German only). | i18n/completeness |
| I18N-20 | The chat window's "Close chat" aria-label. | i18n/completeness |
| I18N-21 | The search caption, "Searched for:". | i18n/completeness |
| I18N-22 | The error for unknown credentials at login, "Invalid email or password". | i18n/completeness |
| I18N-23 | The forgot-password confirmation shows its raw key, `page.forgot-password.confirm`. **The same defect as BUG-20**: both are pins (the functional spec and the translation scan test different surfaces), but it is counted once, under BUG-20. | i18n/completeness |
| I18N-24 | The profile page's aria-label "TOTP code". | i18n/completeness |

### Security

SEC-01..06 are the response headers of the live site; SEC-07..09 are authorisation of the catalogue API, checked on the self-hosted shop.

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

### Performance

| ID | Finding | Pinned in |
|---|---|---|
| PERF-01 | The footer renders at the top before the page content arrives, then jumps down: CLS 0.17 to 0.38 on home, product and contact, against a 0.1 budget. (The cart, at 0.107, is an observation held to a fixed ceiling and to its baseline, not a pin: see Performance.) | performance/budgets |

### Observed, not pinned

These are real, but a deterministic UI test would only restate the observation:

- **`GET /users/refresh` returns 500** instead of 401. On the self-hosted build with debug on, the cause
  shows: an unhandled `Tymon\JWTAuth\Exceptions\JWTException` ("Token could not be parsed"). With a
  JWT that lives 300 s, this means a session cannot be renewed: customers and admins are sent back to
  the login page after 5 minutes. This is not pinned as a UI test, because it would need a 5-minute wait.
  The suite works around it by issuing a fresh token per test for real sessions.
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
| chromium | 976 | Everything except `@account`, `@admin`, `@visual`, `@perf` (own projects) and `@mobile` (phone only). |
| firefox, webkit | 426 each | The same, minus the Chromium-only `@axe` and `@i18n`. |
| perf | 10 | `@perf` budgets and the collector control, alone: one worker, no parallelism. |
| mobile | 18 | `@smoke` and `@mobile` on a Pixel 7. |
| account / admin | 6 / 9, plus one setup test each (7 / 10 listed) | Only exist when real sign-ins may run (always on the self-hosted shop). |
| visual | 18 (17 baselines and the orphan check) | Only inside the Playwright image. |

`@self-hosted` specs are never scheduled against the live site, `@live-only` specs only there. Before
this, those suites called `test.skip()` at file level, which allure-playwright records as a global
error ("skip modifier failed"). Report #6 showed 142 of them on a green run. A gate run now has no
skipped tests at all.
