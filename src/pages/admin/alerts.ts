import type { Locator, Page } from '@playwright/test';
import type { ConsoleGuard } from '@fixtures/console-guard';
import { withMocks, type MockRoute } from '@support/api-mock';
import { failureFeedback } from '@support/feedback';

/**
 * Whether `target` (an alert, a message, any locator) shows anything within `within` ms: the way to observe that nothing is announced.
 * An absence cannot be read off one snapshot (`toHaveCount(0)` passes the instant it is taken, before a
 * response that is still on its way has been drawn), so this watches for an appearance and reports
 * whether one came. Call it after anchoring on content that is rendered last, and once per scenario:
 * a passing test pays the whole window.
 */
export async function appearsWithin(target: Locator, within = 750): Promise<boolean> {
  return target.first().waitFor({ state: 'visible', timeout: within }).then(() => true, () => false);
}

/**
 * What a pin that says "a failure is reported" looks for: an alert, or the plain error text the site draws elsewhere
 * (`failureFeedback`), whichever is visible. Specific enough that a healthy page shows none, which the baselines of the
 * same specs prove with `appearsWithin` on this very locator.
 */
export function reportedFailure(page: Page): Locator {
  return failureFeedback(page).filter({ visible: true }).first();
}

/**
 * What the SPA writes to the console when a request fails, before it shows (or fails to show) anything: its services log
 * the HTTP error (`BrandService Error: ...`), and the rejection is then logged as it is (`ERROR Error: Server Error`,
 * or `ERROR yi`: the minified name of Angular's HttpErrorResponse, with no message). Firefox prints the same line differently
 * (`ERROR Error`, or `ERROR JSHandle@object`), so the pattern also reads the arguments the page passed, serialised by
 * `consoleArgsText`, which are the same in every engine (`"ERROR" Error: Server Error`, `"ERROR" {"message":"Server Error"}`, `"ERROR" {..."name":"HttpErrorResponse"...}`).
 * A test that mocks a failure declares it with `allowLoggedFailure`: the line mirrors a response the test itself controls,
 * so it says nothing the status does not, and it is allowed only in a test in which a request really failed. Any other error
 * the page logs still fails the test.
 */
export const LOGGED_FAILED_REQUEST = /^(?:\w+Service Error\b|ERROR (?:Error: |\{|\w{1,3}$)|"ERROR" (?:Error: |\{"message":"[^"]*"\}$|\{.*"name":"HttpErrorResponse"))/;

/** Declares, on the test's console guard, the line the SPA logs for the failed request the test mocks (`LOGGED_FAILED_REQUEST`), if a request failed. */
export function allowLoggedFailure(guard: ConsoleGuard): void {
  guard.allow(LOGGED_FAILED_REQUEST, 'the SPA logs the failed request this test mocks', { requiresFailure: true });
}

/**
 * `withMocks` for mocks that fail a request, plus the declaration that the SPA logs it (`allowLoggedFailure`, applied by the
 * `loggedFailure` fixture of fixtures/admin.ts): `test.use(withLoggedFailure(mock.fail('GET', '/brands', 500)))`.
 */
export const withLoggedFailure = (...routes: MockRoute[]) => ({ ...withMocks(...routes), loggedFailure: true });

/** The defect ADM-14 in one sentence, shared by its pins (products, brands, categories, users, messages). */
export const ADM_14 = 'an edit form or detail page whose record fails to load (500) opens empty, with no message: saving it would write blanks.';

/** The defect ADM-12 in one sentence, shared by its pins (brands and categories, mocked and against the real API). */
export const ADM_12 = 'a brand or category the API refuses to save (409, slug taken) leaves the form as it was: no message, no "saved", nothing.';

/** The defect ADM-23 in one sentence, shared by its pins (a refused brand or category edit). */
export const ADM_23 = 'a brand or category edit the API refuses to save (409 slug taken, 500) leaves the form as it was: no message, no "saved", nothing (ADM-12 is the same for a new one).';

/** The defect ADM-25 in one sentence, shared by its pins (ADM-22 is the same for the six lists). */
export const ADM_25 = 'a back-office page or form whose request is refused with 401 (an expired or revoked session) stays where it is and the admin is not sent to the sign-in page (ADM-22 is the same for the lists).';

/** What the back office says back, word for word: the confirmations and the one validation message the specs look for by name. */
export const ADMIN_MESSAGES = {
  productSaved: 'Product saved!',
  productDeleted: 'Product deleted.',
  brandSaved: 'Brand saved!',
  brandDeleted: 'Brand deleted.',
  categorySaved: 'Category saved!',
  categoryDeleted: 'Category deleted.',
  userSaved: 'User saved!',
  userDeleted: 'User deleted.',
  statusUpdated: 'Status updated!',
  settingsSaved: 'Settings saved!',
  quantityRequired: 'Quantity is required',
  /** What the order page says for an invoice it could not load, a missing one or not (ADM-13). */
  invoiceMissing: "This invoice doesn't exist.",
} as const;
