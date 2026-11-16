import type { Locator, Page } from '@playwright/test';

/**
 * Plain-text failure wording, for feedback the site draws without `role="alert"`: the shop reports some failures in an
 * ordinary element (a form's status line, a paragraph in the page body) rather than in an alert. Deliberately specific
 * phrases, not the bare word "error", so a product name or a footer link never counts as a failure message.
 */
export const FAILURE_TEXT = /something went wrong|could ?n.?t be (?:loaded|saved|sent|completed)|(?:failed|unable) to|try again|server error|an error occurred/i;

/**
 * Whatever a shopper or admin is shown when a request fails: an alert (the way the site reports some failures) or
 * the plain error text it uses for others. A pin that says "a failure is reported" asserts this, not `role=alert` alone,
 * so a fix in either form turns the pin red (the fix to record) instead of leaving it green by accident.
 */
export function failureFeedback(page: Page): Locator {
  return page.getByRole('alert').or(page.getByText(FAILURE_TEXT));
}
