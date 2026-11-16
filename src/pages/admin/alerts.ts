import type { Locator, Page } from '@playwright/test';
import type { ConsoleGuard } from '@fixtures/console-guard';
import { failureFeedback } from '@support/feedback';

/**
 * Whether `alerts` shows anything within `within` ms: the way to observe that nothing is announced.
 * An absence cannot be read off one snapshot (`toHaveCount(0)` passes the instant it is taken, before a
 * response that is still on its way has been drawn), so this watches for an appearance and reports
 * whether one came. Call it after anchoring on content that is rendered last, and once per scenario:
 * a passing test pays the whole window.
 */
export async function alertAppears(alerts: Locator, within = 750): Promise<boolean> {
  return alerts.first().waitFor({ state: 'visible', timeout: within }).then(() => true, () => false);
}

/**
 * What a pin that says "a failure is reported" looks for: an alert, or the plain error text the site draws elsewhere
 * (`failureFeedback`), whichever is visible. Specific enough that a healthy page shows none, which the baselines of the
 * same specs prove with `alertAppears` on this very locator.
 */
export function reportedFailure(page: Page): Locator {
  return failureFeedback(page).filter({ visible: true }).first();
}

/**
 * What the SPA writes to the console when a request fails, before it shows (or fails to show) anything: its services log
 * the HTTP error (`BrandService Error: ...`), and the rejection is then logged as it is (`ERROR Error: Server Error`,
 * or `ERROR yi`: the minified name of Angular's HttpErrorResponse, with no message). A test that
 * mocks a failure declares it with `consoleGuard.allow(LOGGED_FAILED_REQUEST, ...)`: the line mirrors a response the test
 * itself controls, so it says nothing the status does not. Any other error the page logs still fails the test.
 */
export const LOGGED_FAILED_REQUEST = /^(?:\w+Service Error\b|ERROR (?:Error: |\{|\w{1,3}$))/;

/** Declares, on the test's console guard, the line the SPA logs for the failed request the test mocks (`LOGGED_FAILED_REQUEST`). */
export function allowLoggedFailure(guard: ConsoleGuard): void {
  guard.allow(LOGGED_FAILED_REQUEST, 'the SPA logs the failed request this test mocks');
}

/** The defect ADM-14 in one sentence, shared by its pins (products, brands, categories, users, messages). */
export const ADM_14 = 'an edit form or detail page whose record fails to load (500) opens empty, with no message: saving it would write blanks.';

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
