import { expect, mock, test, withMocks } from '@fixtures';
import type { Locator } from '@playwright/test';
import type { A11yFixtures } from '@fixtures/a11y';
import { KNOWN_VIOLATIONS, type KnownViolation } from '@support/a11y-baseline';
import { contactMessage } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';
import { fakeAddress, fakeGuest } from '@support/test-data';
import { RegisterPage } from '@pages/RegisterPage';

/**
 * One pin per known violation (src/support/a11y-baseline.ts). Each test waits for the offending
 * element itself to show, scans for its single rule and asserts the element no longer violates
 * it: expected to fail today, red once fixed. A scan that ran before the element rendered could
 * "pass" for the wrong reason, so every pin names its element in `anchors`.
 * @axe: Chromium only, like the baseline it pins (see pages.a11y.spec.ts).
 */
const summaryOf = (v: KnownViolation) => `${v.rule} (${v.impact}, WCAG ${v.wcag}): ${v.summary}`;

/** Moves to another page of the violation's baseline entry and returns the element it is about there. */
type Visit = () => Promise<Locator>;

/**
 * Scans the page the pin opens (named by `scan`) and every page in `alsoOn`, and asserts the
 * violation is gone from all of them. `alsoOn` is the other pages of the baseline entry that
 * the pin can reach cheaply; visits run in order and may build on each other. Pages of the entry
 * it does not reach are watched by the baseline ratchet in pages.a11y.spec.ts.
 */
async function expectFixed(a11y: A11yFixtures['a11y'], violation: KnownViolation, scan: string, offending: Locator, alsoOn: Record<string, Visit> = {}): Promise<void> {
  // A pin must scan pages its baseline entry was recorded on, or a "fix" on a page the entry never covered would pass for nothing.
  for (const name of [scan, ...Object.keys(alsoOn)]) {
    if (!violation.pages.includes(name)) throw new Error(`The pin scans "${name}", which is not one of the pages its baseline entry was recorded on (${violation.pages.join(', ')})`);
  }
  const stillOn: string[] = [];
  const check = async (name: string, anchor: Locator) => {
    await expect(anchor).toBeVisible();
    const result = await a11y.scan(`${violation.id}-${name}`, { only: [violation.rule] });
    if (result.findings.some((f) => f.target === violation.target)) stillOn.push(name);
  };
  await check(scan, offending);
  for (const [name, visit] of Object.entries(alsoOn)) await check(name, await visit());

  expect(stillOn, `${violation.id}: ${violation.rule} on ${violation.target} is fixed on every page it was recorded on that the pin scans`).toEqual([]);
}

const on = (page: KnownViolation['page']) => KNOWN_VIOLATIONS.filter((v) => v.page === page);

/**
 * The element each pin is about, by pin id: the page object's own locator for it. A missing
 * anchor throws without the pin's id, so it is never read as the bug reproducing (VERIFY_BUGS).
 */
function anchorOf<Page>(anchors: Record<string, (page: Page) => Locator>, violation: KnownViolation, page: Page): Locator {
  const anchor = anchors[violation.id];
  if (!anchor) throw new Error(`A pin for ${violation.rule} on ${violation.target} has no anchor: name the element it is about`);
  return anchor(page);
}

test.describe('Known accessibility violations', { tag: ['@a11y', '@axe', '@bug'] }, () => {
  for (const violation of on('home')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (home)`, async ({ homePage, product, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-08': (p: typeof homePage) => p.header.language.button, 'AX-11': (p: typeof homePage) => p.filters.categories };
      const categories = homePage.filters.categories;
      // AX-08 is on every page of the site, so it is pinned on the home page and the ratchet watches the rest.
      const alsoOn: Record<string, Visit> =
        violation.id === 'AX-11'
          ? {
              'search results': async () => {
                await homePage.search.searchFor(product.name);
                await expect(homePage.grid.cards.first()).toBeVisible();
                return categories;
              },
              'search without results': async () => {
                await homePage.search.searchFor('qa-lab-no-such-product');
                await expect(homePage.grid.emptyState).toBeVisible();
                return categories;
              },
            }
          : {};
      await expectFixed(a11y, violation, 'home', anchorOf(anchors, violation, homePage), alsoOn);
    });
  }

  for (const violation of on('product')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (product)`, async ({ productPage, catalog, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-13': (p: typeof productPage) => p.relatedProducts.first() };
      await expectFixed(a11y, violation, 'product', anchorOf(anchors, violation, productPage), {
        'product out of stock': async () => {
          await productPage.open((await catalog.outOfStock()).id);
          await expect(productPage.outOfStock).toBeVisible();
          return productPage.relatedProducts.first();
        },
      });
    });
  }

  for (const violation of on('cart')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (cart)`, async ({ checkout, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-09': (p: typeof checkout) => p.header.cartLink };
      // The same walk as the scan in pages.a11y.spec.ts: each visit builds on the one before.
      await expectFixed(a11y, violation, 'cart', anchorOf(anchors, violation, checkout), {
        'checkout sign-in': async () => {
          await checkout.cart.proceed();
          await expect(checkout.signIn.loginButton).toBeVisible();
          return checkout.header.cartLink;
        },
        'checkout guest with errors': async () => {
          await checkout.signIn.guestTab.click();
          await checkout.signIn.continueAsGuestButton.click();
          await expect(checkout.signIn.guestEmail.error).toBeVisible();
          return checkout.header.cartLink;
        },
        'checkout billing': async () => {
          await checkout.signIn.continueAsGuest(fakeGuest());
          await expect(checkout.billing.heading).toBeVisible();
          return checkout.header.cartLink;
        },
        'checkout payment': async () => {
          await checkout.billing.enterAddress(fakeAddress());
          await checkout.billing.proceed();
          await checkout.payment.choose('credit-card');
          await expect(checkout.payment.field('Credit Card Number')).toBeVisible();
          return checkout.header.cartLink;
        },
      });
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
      await expectFixed(a11y, violation, 'checkout sign-in', anchorOf(anchors, violation, checkout));
    });
  }

  for (const violation of on('login')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (login)`, async ({ loginPage, page, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-04': (p: typeof loginPage) => p.showPasswordButton };
      await expectFixed(a11y, violation, 'login with errors', anchorOf(anchors, violation, loginPage), {
        'register with errors': async () => {
          const registerPage = new RegisterPage(page);
          await registerPage.open();
          return registerPage.showPasswordButton;
        },
      });
    });
  }

  for (const violation of on('register')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (register)`, async ({ registerPage, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      const anchors = { 'AX-10': (p: typeof registerPage) => p.passwordRules.first() };
      // Its other page, the profile, needs a mocked session and is watched by the baseline ratchet.
      await expectFixed(a11y, violation, 'register with errors', anchorOf(anchors, violation, registerPage));
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
        await expectFixed(a11y, violation, 'account profile', anchorOf(anchors, violation, profilePage));
      });
    }
  });

  test.describe('back office (mocked admin)', { tag: ['@mocked'] }, () => {
    for (const violation of on('admin messages')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (admin inbox)`, async ({ adminMessages, a11y }) => {
        knownBug(violation.id, summaryOf(violation));
        // The pill of the one mocked message; the message page shows it too and is watched by the baseline ratchet.
        const anchors = { 'AX-07': (p: typeof adminMessages) => p.table.statusBadge(contactMessage.status) };
        await expectFixed(a11y, violation, 'admin messages', anchorOf(anchors, violation, adminMessages));
      });
    }
  });
});
