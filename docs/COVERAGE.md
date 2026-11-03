# Coverage

Every control and flow the research pass found on practicesoftwaretesting.com (Toolshop v5.0, UI build
"v2.5, Angular 20"), what covers it, and where it stands. API paths are on
`https://api.practicesoftwaretesting.com`. Product lists and search use the HTTP method `QUERY` with a
JSON body.

**Columns.** *Pos* = positive case, *Neg* = negative case (validation, wrong input, navigation that
must not happen), *Fail* = API mocked to a 4xx/5xx or a network abort, *Empty* = API mocked to an empty
200 of the real shape. `yes` = covered, `n/a` = not meaningful for that control (no request, no data).

**Status.** `covered` = every applicable column has a passing test. `bug found` = covered, and at least
one test pins a site defect with `knownBug()` (see [Bugs found](#bugs-found)). `blocked` = deliberately
not automated, with the reason. `written, gated` = the spec exists but only runs with
`RUN_ACCOUNT_TESTS=1`, because it creates or uses a real account.

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
| Admin area (/admin/*) | – | many | – | – | – | – | – | blocked: needs the admin role; signing in as the published demo admin is outside this suite's safety rules, and a fully mocked back office would only test the mocks |

## Banners and footer

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Notification bar "Documentation" link | link "Documentation" | – | yes (href, target) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Course promo "Explore courses" | link "Explore courses" | – | yes (href with UTM, target) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Footer: courses, API Spector, GitHub | links by name | – | yes (href, target, rel) | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Footer: Privacy Policy | link "Privacy Policy" | – | yes | n/a | n/a | n/a | navigation/banners-and-footer | covered |
| Testing Guide: open, Next, Previous (disabled on step 1), Escape | button "Testing Guide", "Next →", "← Previous" | – | yes | yes | n/a | n/a | navigation/banners-and-footer | covered |
| Testing Guide "Mark as read" | checkbox "Mark as read" | – | – | – | – | – | – | blocked: a training aid outside the shop, with no visible effect beyond its own checkbox |
| "Bug Hunting" button | button "🐛 Bug Hunting" | – | – | – | – | – | – | blocked: opens a split-screen training panel; at 1280 px headless it rendered nothing visible to assert on |

## Product overview: search, sort, filters, pagination

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Product grid (cards: name, price, stock) | links with an h5 | QUERY /products | yes | n/a | yes (500, abort) | yes | catalog/filters | bug found (BUG-04) |
| Search by button and by Enter | textbox / button "Search" | QUERY /products/search `{q}` | yes | yes (no match) | yes | yes | catalog/search | bug found (BUG-03) |
| Search caption and result count | `[search-caption]`, `[search-result-count]` | – | yes | yes | n/a | yes | catalog/search | covered |
| Search reset "X" | button "X" | QUERY /products | yes | n/a | n/a | n/a | catalog/search | covered |
| Sort: 6 options | combobox "sort" | QUERY /products `{sort}` | yes (×6) | n/a | n/a | n/a | catalog/sort | covered |
| Category checkbox | checkbox by name | QUERY /products `{by_category}` | yes | n/a | yes | yes | catalog/filters | bug found (BUG-05) |
| Parent category ticks its subcategories | checkbox "Power Tools" | – | yes | yes (siblings stay unticked) | n/a | n/a | catalog/filters | covered |
| Brand checkbox | checkbox by name | QUERY /products `{by_brand}` | yes | n/a | yes | yes | catalog/filters | bug found (BUG-05) |
| Eco-friendly only | checkbox "Show only eco-friendly products" | QUERY /products `{eco_friendly}` | yes | n/a | n/a | n/a | catalog/filters | covered |
| Combined filters; untick restores | – | QUERY /products | yes | n/a | n/a | n/a | catalog/filters | covered |
| Price slider, max and min handles | slider "ngx-slider-max" / "ngx-slider" | QUERY /products `{between}` | yes (both) | n/a | n/a | n/a | catalog/filters | covered |
| Mobile "Filters" fold-out | button "Filters" | – | yes | n/a | n/a | n/a | @smoke specs on the mobile project | covered |
| Pagination: Next, Previous, page number, last page | buttons "Next", "Previous", "Page-N" | QUERY /products `{page}` | yes | yes | n/a | yes (single page: no pagination) | catalog/pagination | covered |
| Pagination end buttons disabled for assistive tech | button "Previous" | – | n/a | yes | n/a | n/a | catalog/pagination | bug found (A11Y-03) |

## Category pages and rentals

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| /category/hand-tools, power-tools, other | `[page-title]`, grid | QUERY /products `{by_category_slug}` | yes (×3) | n/a | yes | yes (special-tools) | catalog/category-pages | bug found (BUG-04) |
| Unknown category slug | `[page-title]` | QUERY /products | n/a | yes | n/a | n/a | catalog/category-pages | bug found (BUG-06) |
| Rentals list | heading "Rentals", `[product-<id>]` | QUERY /products `{is_rental}` | yes | n/a | yes | yes | catalog/rentals | bug found (BUG-07, BUG-08) |
| Rental detail (no quantity picker) | heading, button "Add to cart" | GET /products/{id} | yes | n/a | n/a | n/a | catalog/rentals | covered |

## Comparison

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Compare toggle on a card (aria-pressed) | button "Compare" | – (sessionStorage) | yes | yes (toggle off) | n/a | n/a | catalog/compare | covered |
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
| Quantity +/- (floor at 1) | buttons "Increase/Decrease quantity", spinbutton "Quantity" | – | yes | yes | n/a | n/a | product/product-detail | covered |
| Typed quantity 0, empty, 2.5, > 99 | spinbutton "Quantity" | – | n/a | yes (×4) | n/a | n/a | product/product-detail | covered |
| Add to cart, toast, header count | button "Add to cart" | POST /carts, POST /carts/{id} | yes | n/a | yes (500, abort) | n/a | product/product-detail | bug found (BUG-10) |
| Add to favourites (signed out / in / duplicate) | button "Add to favourites" | POST /favorites | yes (mocked session) | yes (401, 422) | n/a | n/a | product/product-detail | covered |
| Related products | links with an h5 | GET /products/{id}/related | yes | n/a | n/a | yes | product/product-detail | covered |
| Out-of-stock state | text "Out of stock", disabled controls | – | n/a | yes | n/a | n/a | product/product-detail | covered |
| ECO badge | `[eco-badge]` | – | yes | n/a | n/a | n/a | product/product-detail | covered |

## Cart (checkout step 1)

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Lines: title, quantity, unit price, line total, cart total | table rows, `[line-price]`, `[cart-total]` | GET /carts/{id} | yes | yes (no cart) | yes | yes | cart/cart | bug found (BUG-13) |
| Change quantity | spinbutton "Quantity for …" | PUT /carts/{id}/product/quantity | yes | yes (0, > 99) | yes | n/a | cart/cart | bug found (BUG-14) |
| Remove a line; remove the last line | remove control (CSS, see A11Y-01) | DELETE /carts/{id}/product/{pid} | yes | n/a | yes | n/a | cart/cart | bug found (BUG-15, A11Y-01) |
| Eco discount 5% (eco-only cart) | `[cart-subtotal]`, `[cart-eco-discount]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| Combination discount 15% (rental + product), "price per hour" | `[cart-discount]` | – | yes | n/a | n/a | n/a | cart/cart | covered |
| Continue Shopping, Proceed to checkout | buttons by name, `[proceed-1]` | – | yes | n/a | n/a | n/a | cart/cart | covered |

## Checkout steps 2–4

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Sign in / Continue as Guest tabs | tab by name | – | yes | n/a | n/a | n/a | checkout/sign-in-step | covered |
| Sign-in validation (empty, format, length, wrong credentials) | labels, `[email-error]`, `[login-error]` | POST /users/login (401) | n/a | yes (×4) | n/a | n/a | checkout/sign-in-step | covered |
| Guest details, confirmation, proceed | labels, `[proceed-2-guest]` | – | yes | yes (empty, bad email) | n/a | n/a | checkout/sign-in-step | covered |
| Signed-in checkout (proceed without guest step) | `[proceed-2]` | POST /invoices | yes | – | – | – | account/live-account | written, gated |
| Billing address, Proceed disabled until complete | labels, `[proceed-3]` | – | yes | yes | n/a | n/a | checkout/billing-step | covered |
| Postcode lookup fills street / city / state | labels | GET /postcode-lookup | yes | yes (404) | yes (500) | n/a | checkout/billing-step | covered |
| Payment method list (5) | combobox "Payment Method" | – | yes | n/a | n/a | n/a | checkout/payment-step | covered |
| Fields per method: bank, card, BNPL, gift card; COD has none | labels | – | yes (×5) | n/a | n/a | n/a | checkout/payment-step | covered |
| Field validation with non-numeric junk (bank, card, gift card) | validation texts | – | n/a | yes (×3) | n/a | n/a | checkout/payment-step | covered |
| Credit card with empty fields | button "Check payment" | – | n/a | yes | n/a | n/a | checkout/payment-step | bug found (BUG-16) |
| BNPL instalment choice enables the check | select "Monthly Installments" | – | yes | yes | n/a | n/a | checkout/payment-step | covered |
| Check payment → Confirm | `[payment-success-message]`, `[payment-error-message]` | POST /payment/check | yes | yes (400 declined) | yes (500) | n/a | checkout/payment-step | covered |
| Place order and confirmation (invoice number) | text "Thanks for your order! …" | POST /invoices/guest | yes | n/a | yes (500, 422) | n/a | checkout/payment-step, purchase-flow | bug found (BUG-17) |
| Card, bank and gift-card payments with real-looking numbers | – | POST /payment/check | – | – | – | – | – | blocked: the suite never types card, bank or gift-card numbers, not even fake ones |

## Purchase flows (@flow)

| Flow | API calls | Spec | Status |
|---|---|---|---|
| Browse → product → quantity 2 → cart → guest → billing → Cash on Delivery → invoice number, cart emptied | POST /carts, /carts/{id}, /payment/check, /invoices/guest | checkout/purchase-flow | covered |
| Search ×3 → three products → change a quantity → remove a line → order; invoice total = cart total, billing city = city on screen | as above + PUT, DELETE | checkout/purchase-flow | covered |
| Signed-in purchase appears on the customer's invoices | POST /invoices, GET /invoices | account/live-account | written, gated |

## Login, registration, password reset

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Login validation (empty, format, length) and no request sent | labels, `[email-error]`, `[password-error]` | – | n/a | yes | n/a | n/a | auth/login | covered |
| Wrong credentials | `[login-error]` | POST /users/login (401) | n/a | yes | n/a | n/a | auth/login | covered |
| Successful login → account, signed-in header | – | POST /users/login, GET /users/me (mocked) | yes | n/a | yes (500, abort, 423 locked) | n/a | auth/login | covered |
| Two-factor (TOTP) step and empty code | textbox "TOTP Code", button "Verify TOTP" | POST /users/login (mocked) | yes | yes | n/a | n/a | auth/login | covered |
| Show/hide password | unnamed button | – | yes | n/a | n/a | n/a | auth/login, auth/register | bug found (A11Y-02) |
| Register / Forgot password links | links by name | – | yes | n/a | n/a | n/a | auth/login | covered |
| Sign in with Google | button "Sign in with Google" | – | yes (present) | – | – | – | auth/login | blocked: starts a real third-party OAuth flow; presence only |
| Registration: 12 required fields | labels, `[<field>-error]` | – | n/a | yes | n/a | n/a | auth/register | covered |
| Registration: date, phone, email, password formats | labels | – | n/a | yes (×5) | n/a | n/a | auth/register | covered |
| Registration: future date of birth | `[dob-error]` | – | n/a | yes | n/a | n/a | auth/register | bug found (BUG-18) |
| Registration: password rules, reveal | list items, unnamed button | – | yes | n/a | n/a | n/a | auth/register | covered |
| Registration: postcode lookup | labels | GET /postcode-lookup (mocked) | yes | n/a | n/a | n/a | auth/register | covered |
| Registration submit: body, redirect to login | – | POST /users/register (mocked 201) | yes | yes (422 duplicate) | yes (500) | n/a | auth/register | covered |
| Registration → login → account area | – | mocked register, login, me | yes | n/a | n/a | n/a | auth/registration-flow | covered |
| Same journey against the real API; duplicate email | – | real | yes | yes | – | – | account/live-account | written, gated |
| Forgot password: empty, malformed, unknown email | `[email-error]`, alert | POST /users/forgot-password (422) | n/a | yes (×3) | n/a | n/a | auth/forgot-password | bug found (BUG-19) |
| Forgot password: accepted / failed | – | POST /users/forgot-password (mocked) | yes | n/a | yes | n/a | auth/forgot-password | bug found (BUG-20) |

## Account area

Mocked session (fake JWT + mocked `GET /users/me`) unless marked gated.

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Account page tiles to four sections | `[nav-favorites]`... | – | yes | n/a | n/a | n/a | account/account-area | covered |
| Favorites list and remove | `[favorite-<id>]`, `[delete]` | GET /favorites, DELETE /favorites/{id} | yes | n/a | yes | yes | account/account-area | bug found (BUG-23) |
| Invoices list and invoice details | table rows, link "Details" | GET /invoices, GET /invoices/{id} | yes | n/a | yes | n/a | account/account-area | bug found (BUG-24) |
| Invoice "Download PDF" | button "Download PDF" | GET /invoices/{n}/download-pdf | yes (present) | – | – | – | account/account-area | blocked: the PDF is generated asynchronously by the real backend; mocking it would only test the mock |
| Messages list, details, reply | rows, link "Details", textbox "Message" | GET /messages, GET /messages/{id}, POST /messages/{id}/reply | yes | n/a | n/a | yes | account/account-area | covered |
| Profile prefilled, update | labels, button "Update Profile" | GET /users/me, PUT /users/{id} | yes | n/a | n/a | n/a | account/account-area | covered |
| Change password | textboxes by name, button "Change Password" | POST /users/change-password | yes | yes | n/a | n/a | account/account-area | bug found (BUG-26) |
| Profile TOTP setup | `[totp-secret]`, `[verify-totp]` | POST /totp/setup | – | – | – | – | – | blocked: enrolling 2FA needs a real authenticator secret from the real backend |
| Real session from storageState; per-worker account favorites | – | real | yes | – | – | – | account/live-account | written, gated |

## Contact

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Subjects (6) | combobox "Subject" | – | yes | n/a | n/a | n/a | contact/contact | covered |
| Required fields (5) | labels, `[<field>-error]` | – | n/a | yes | n/a | n/a | contact/contact | covered |
| Email format, message < 50 characters | labels | – | n/a | yes (×2) | n/a | n/a | contact/contact | covered |
| Attachment: not empty, not .txt, empty .txt accepted | "Attachment", `[attachment-error]` | – | yes | yes (×2) | n/a | n/a | contact/contact | covered |
| Send: request body and confirmation | button "Send", alert | POST /messages | yes (real, fake example.com sender) | n/a | yes (500, 422, abort) | n/a | contact/contact | bug found (BUG-21, BUG-22) |

## Widgets

| Feature / control | Locator | API call | Pos | Neg | Fail | Empty | Spec | Status |
|---|---|---|---|---|---|---|---|---|
| Chat: open, greeting, menu, close | buttons "Open chat", "Close chat" | – | yes | n/a | n/a | n/a | widgets/chat | covered |
| Chat: Find a product | textbox "Message", button "Send message", `[chat-product]` | QUERY /products/search | yes | n/a | yes | yes | widgets/chat | bug found (BUG-25) |
| Chat: Order a product, Checkout (empty cart), Back to menu | buttons by name | – | yes | yes | n/a | n/a | widgets/chat | covered |
| Chat: support ticket (name, email, subject, message, skip attachment) | buttons and textbox | POST /messages (mocked) | yes | n/a | n/a | n/a | widgets/chat | covered |
| Chat: file attachment | `[chat-file-input]` | – | – | – | – | – | – | blocked: only reachable at the end of the ticket flow; the upload goes to the real messages API |
| Live activity: open, counters, close | button "Show live shop activity", `[live-activity-*]` | GET /sales-stream (SSE, mocked) | yes | n/a | n/a | yes | widgets/live-activity | covered |
| Live activity: incoming sales listed, totals add up | `[live-activity-item]` | GET /sales-stream (mocked) | yes | n/a | n/a | n/a | widgets/live-activity | covered |

## Bugs found

Every entry below was reproduced by the suite. The pinned test states the behaviour the shop should have
and is wrapped in `knownBug()` (`test.fail`): it passes while the bug exists and fails the day it is
fixed. `npm run test:verify-bugs` runs them as ordinary tests to show each failing at its last assertion.

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
| BUG-13 | Cart | With no cart, or when the cart fails to load, only the step header shows: not "The cart is empty", no error. | cart/cart |
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

### Accessibility

| ID | Where | What happens | Pinned in |
|---|---|---|---|
| A11Y-01 | Cart | The remove-line control is an `<a>` with an icon, no href and no accessible name: neither a link nor a button. | cart/cart |
| A11Y-02 | Login, register, profile | The eye button that reveals the password has no accessible name. | auth/login |
| A11Y-03 | Pagination | End buttons are only styled as disabled (a class on the `<li>`); the `<button>` stays enabled and focusable. The current page has no `aria-current`. | catalog/pagination |
| A11Y-04 | Account menu | "Sign out" is an `<a>` without href: no link role, not reachable with Tab. | account/account-area |

### Observed, not pinned

These are real, but a deterministic UI test would only restate the observation:

- **`GET /users/refresh` returns 500** (`{"message":"Server Error"}`) whenever a signed-out visitor opens
  a protected route, 8 times out of 8. A 401 is expected. The redirect to login still works.
- **The postcode lookup fires twice per change, and its late answer overwrites typed fields.** Combined
  with the API's rule that the city must belong to the country, a shopper who types their own city can
  end up with an order rejected silently (BUG-17). The suite keeps the address the lookup suggests.
- **The lookup returns plausible but random addresses** for any postcode in any country.
- **Compare on the product page gives no feedback**: no bar, no toast. The product does reach /comparison.
- **The shared demo data drifts**: other users' test categories ("TesztKategoria11") appear in the public
  filters, and stock flips (Combination Pliers went out of stock during this work). This is why the suite
  looks every product up at runtime and never assumes fixed counts.
- **Rental cards** are focusable `<div>`s rather than links.
- **The API is intermittently unavailable.** `POST /carts` returned 500 once in three tries during research. In the final run it returned 500, then redirected to a 404, for several minutes in a row.

## Final run (4 Nov 2026, local, retries 1)

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 219 | 0 | 0 | 1 (the @mobile-only toggle test) |
| firefox | 212 | 5 | 2 | 1 (same) |
| mobile (Pixel 7, @smoke and @mobile) | 14 | 0 | 0 | 0 |
| account and account-setup (gated) | 0 | 0 | 0 | 6 |

The 5 Firefox failures were all in the cart setup (`POST /carts` 500, then 404) during one outage
window. A re-run of the cart and comparison specs on Firefox passed 29/29. Expected failures of
`knownBug()` tests count as passed.
