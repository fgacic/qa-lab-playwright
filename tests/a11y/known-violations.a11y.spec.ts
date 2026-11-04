import { expect, mock, test, withMocks } from '@fixtures';
import type { A11yFixtures } from '../../fixtures/a11y';
import { KNOWN_VIOLATIONS, type KnownViolation } from '@support/a11y-baseline';
import { knownBug } from '@support/known-bug';

/**
 * One pin per known violation (src/support/a11y-baseline.ts). Each test scans for its single
 * rule and asserts the element no longer violates it: expected to fail today, red once fixed.
 * @axe: Chromium only, like the baseline it pins (see pages.a11y.spec.ts).
 */
async function expectFixed(a11y: A11yFixtures['a11y'], violation: KnownViolation): Promise<void> {
  knownBug(violation.id, `${violation.rule} (${violation.impact}, WCAG ${violation.wcag}): ${violation.summary}`);
  const scan = await a11y.scan(violation.id, { only: [violation.rule] });

  expect(scan.findings.filter((f) => f.target === violation.target).map((f) => f.target)).toEqual([]);
}

const on = (page: KnownViolation['page']) => KNOWN_VIOLATIONS.filter((v) => v.page === page);

test.describe('Known accessibility violations', { tag: ['@a11y', '@axe', '@bug'] }, () => {
  for (const violation of on('home')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (home)`, async ({ homePage, a11y }) => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      await expectFixed(a11y, violation);
    });
  }

  for (const violation of on('product')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (product)`, async ({ productPage, a11y }) => {
      await expect(productPage.relatedProducts.first()).toBeVisible();
      await expectFixed(a11y, violation);
    });
  }

  for (const violation of on('cart')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (cart)`, async ({ checkout, a11y }) => {
      await expect(checkout.cart.table.rows.first()).toBeVisible();
      await expectFixed(a11y, violation);
    });
  }

  for (const violation of on('checkout sign-in')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (checkout sign-in)`, async ({ checkout, a11y }) => {
      await checkout.cart.proceed();
      await expect(checkout.signIn.loginButton).toBeVisible();
      await expectFixed(a11y, violation);
    });
  }

  for (const violation of on('login')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (login)`, async ({ loginPage, a11y }) => {
      await expect(loginPage.loginButton).toBeVisible();
      await expectFixed(a11y, violation);
    });
  }

  for (const violation of on('register')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (register)`, async ({ registerPage, a11y }) => {
      await expect(registerPage.passwordRules.first()).toBeVisible();
      await expectFixed(a11y, violation);
    });
  }


  test.describe('account (mocked session)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/totp/setup', {})));

    for (const violation of on('account profile')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (profile)`, async ({ profilePage, a11y }) => {
        await expect(profilePage.changePasswordButton).toBeVisible();
        await expectFixed(a11y, violation);
      });
    }
  });

  test.describe('back office (mocked admin)', { tag: ['@mocked'] }, () => {
    for (const violation of on('admin messages')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (admin inbox)`, async ({ adminMessages, a11y }) => {
        await expect(adminMessages.table.rows.first()).toBeVisible();
        await expectFixed(a11y, violation);
      });
    }
  });
});
