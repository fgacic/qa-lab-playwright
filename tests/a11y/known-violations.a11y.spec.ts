import { expect, mock, test, withMocks } from '@fixtures';
import type { Locator } from '@playwright/test';
import type { A11yFixtures } from '@fixtures/a11y';
import { KNOWN_VIOLATIONS, type KnownViolation } from '@support/a11y-baseline';
import { knownBug } from '@support/known-bug';

/**
 * One pin per known violation (src/support/a11y-baseline.ts). Each test waits for the offending
 * element itself to show, scans for its single rule and asserts the element no longer violates
 * it: expected to fail today, red once fixed. A scan that ran before the element rendered could
 * "pass" for the wrong reason, so every pin names its element in `anchors`.
 * @axe: Chromium only, like the baseline it pins (see pages.a11y.spec.ts).
 */
const summaryOf = (v: KnownViolation) => `${v.rule} (${v.impact}, WCAG ${v.wcag}): ${v.summary}`;

async function expectFixed(a11y: A11yFixtures['a11y'], violation: KnownViolation, offending: Locator): Promise<void> {
  await expect(offending).toBeVisible();
  const scan = await a11y.scan(violation.id, { only: [violation.rule] });

  expect(
    scan.findings.filter((f) => f.target === violation.target).map((f) => f.target),
    `${violation.id}: ${violation.rule} on ${violation.target} is fixed`,
  ).toEqual([]);
}

const on = (page: KnownViolation['page']) => KNOWN_VIOLATIONS.filter((v) => v.page === page);

/** The element each pin is about, by pin id: the page object's own locator for it. */
function anchorOf<Page>(anchors: Record<string, (page: Page) => Locator>, violation: KnownViolation, page: Page): Locator {
  const anchor = anchors[violation.id];
  if (!anchor) throw new Error(`${violation.id} has no anchor: name the element it is about`);
  return anchor(page);
}

test.describe('Known accessibility violations', { tag: ['@a11y', '@axe', '@bug'] }, () => {
  for (const violation of on('home')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (home)`, async ({ homePage, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-08': (p: typeof homePage) => p.header.language.button, 'AX-11': (p: typeof homePage) => p.filters.categories };
      await expectFixed(a11y, violation, anchorOf(anchors, violation, homePage));
    });
  }

  for (const violation of on('product')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (product)`, async ({ productPage, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-13': (p: typeof productPage) => p.relatedProducts.first() };
      await expectFixed(a11y, violation, anchorOf(anchors, violation, productPage));
    });
  }

  for (const violation of on('cart')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (cart)`, async ({ checkout, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-09': (p: typeof checkout) => p.header.cartLink };
      await expectFixed(a11y, violation, anchorOf(anchors, violation, checkout));
    });
  }

  for (const violation of on('checkout sign-in')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (checkout sign-in)`, async ({ checkout, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      await checkout.cart.proceed();
      const anchors = {
        'AX-01': (p: typeof checkout) => p.signIn.signInTab,
        'AX-02': (p: typeof checkout) => p.signIn.signInTab,
        'AX-03': (p: typeof checkout) => p.signIn.guestTab,
        'AX-12': (p: typeof checkout) => p.signIn.signInTab,
      };
      await expectFixed(a11y, violation, anchorOf(anchors, violation, checkout));
    });
  }

  for (const violation of on('login')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (login)`, async ({ loginPage, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-04': (p: typeof loginPage) => p.showPasswordButton };
      await expectFixed(a11y, violation, anchorOf(anchors, violation, loginPage));
    });
  }

  for (const violation of on('register')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (register)`, async ({ registerPage, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-10': (p: typeof registerPage) => p.passwordRules.first() };
      await expectFixed(a11y, violation, anchorOf(anchors, violation, registerPage));
    });
  }

  test.describe('account (mocked session)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/totp/setup', {})));

    for (const violation of on('account profile')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (profile)`, async ({ profilePage, a11y }) => {
        knownBug(violation.id, summaryOf(violation));
        const anchors = {
          'AX-05': (p: typeof profilePage) => p.newPassword,
          'AX-06': (p: typeof profilePage) => p.confirmNewPassword,
        };
        await expectFixed(a11y, violation, anchorOf(anchors, violation, profilePage));
      });
    }
  });

  test.describe('back office (mocked admin)', { tag: ['@mocked'] }, () => {
    for (const violation of on('admin messages')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (admin inbox)`, async ({ adminMessages, a11y }) => {
        knownBug(violation.id, summaryOf(violation));
        // The first row stands for its status badge until the page object names one (see the report).
        const anchors = { 'AX-07': (p: typeof adminMessages) => p.table.rows.first() };
        await expectFixed(a11y, violation, anchorOf(anchors, violation, adminMessages));
      });
    }
  });
});
