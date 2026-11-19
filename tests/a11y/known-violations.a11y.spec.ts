import { PAYMENT_FIELDS } from '@components/checkout/PaymentStep';
import { expect, mock, test, withMocks } from '@fixtures';
import type { Locator } from '@playwright/test';
import { NO_SUCH_PRODUCT, type A11yFixtures } from '@fixtures/a11y';
import { KNOWN_VIOLATIONS, type AxId, type PinnedViolation, type ScanName } from '@support/a11y-baseline';
import { contactMessage } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';
import { fakeAddress, fakeGuest } from '@support/test-data';
import type { AdminListPage } from '@pages/admin/AdminListPage';
import type { AdminMessagePage } from '@pages/admin/AdminMessagePage';
import type { ProfilePage } from '@pages/account/ProfilePage';
import type { CheckoutPage } from '@pages/CheckoutPage';
import type { HomePage } from '@pages/HomePage';
import type { LoginPage } from '@pages/LoginPage';
import type { ProductPage } from '@pages/ProductPage';
import type { RegisterPage } from '@pages/RegisterPage';

/**
 * One pin per known violation (src/support/a11y-baseline.ts). Each test waits for the offending
 * element itself to show, scans for its single rule and asserts the element no longer violates
 * it: expected to fail today, red once fixed. A scan that ran before the element rendered could
 * "pass" for the wrong reason, so every pin names its element in its page's anchor table (`HOME_ANCHORS`, ...). A baseline entry recorded
 * on a state ("with errors") is pinned in that state: the pin brings the page there before it scans.
 * @axe: Chromium only, like the baseline it pins (see pages.a11y.spec.ts).
 */
const summaryOf = (v: PinnedViolation) => `${v.rule} (${v.impact}, WCAG ${v.wcag}): ${v.summary}`;

/** The element a pin is about, plus anything else its state must show before the scan (the validation errors of a "with errors" state). Never empty: a scan with nothing to wait for is not allowed. */
type Anchor = Locator | [Locator, ...Locator[]];

/** Moves to another page of the violation's baseline entry and returns what it is about there. */
type Visit = () => Promise<Anchor>;

/**
 * Scans the page the pin opens (named by `scan`) and every page in `alsoOn`, and asserts the
 * violation is gone from all of them. `alsoOn` is the other pages of the baseline entry that
 * the pin can reach cheaply; visits run in order and may build on each other. Pages of the entry
 * it does not reach are watched by the baseline ratchet in pages.a11y.spec.ts.
 */
async function expectFixed(a11y: A11yFixtures['a11y'], violation: PinnedViolation, scan: ScanName, offending: Anchor, alsoOn: Partial<Record<ScanName, Visit>> = {}): Promise<void> {
  // A pin must scan pages its baseline entry was recorded on, or a "fix" on a page the entry never covered would pass for nothing.
  for (const name of [scan, ...(Object.keys(alsoOn) as ScanName[])]) {
    if (!violation.pages.includes(name)) throw new Error(`The pin scans "${name}", which is not one of the pages its baseline entry was recorded on (${violation.pages.join(', ')})`);
  }
  const stillOn: string[] = [];
  const check = async (name: ScanName, anchor: Anchor) => {
    const result = await a11y.scan(name, { ready: Array.isArray(anchor) ? anchor : [anchor], only: [violation.rule] });
    if (result.findings.some((f) => f.target === violation.target)) stillOn.push(name);
  };
  await check(scan, offending);
  for (const [name, visit] of Object.entries(alsoOn) as [ScanName, Visit][]) await check(name, await visit());

  expect(stillOn, `${violation.id}: ${violation.rule} on ${violation.target} is fixed on every page it was recorded on that the pin scans`).toEqual([]);
}

/** The entries whose pin scans `page`. That every entry's page has such a loop below is checked in tests/framework/a11y-baseline.spec.ts, which reads this file. */
const on = (page: PinnedViolation['page']): PinnedViolation[] => KNOWN_VIOLATIONS.filter((v) => v.page === page);

/**
 * The element each pin is about, by pin id: the page object's own locator for it, one table per page the pins scan.
 * A missing anchor throws without the pin's id, so it is never read as the bug reproducing (VERIFY_BUGS).
 */
// Keyed by AxId: an id that is not in the baseline (a typo, an entry that was removed) is a compile error. An entry with no anchor is still caught at run time.
type Anchors<Page> = Partial<Record<AxId, (page: Page) => Anchor>>;

const HOME_ANCHORS: Anchors<HomePage> = { 'AX-08': (p) => p.header.language.button, 'AX-11': (p) => p.filters.categories };
const PRODUCT_ANCHORS: Anchors<ProductPage> = { 'AX-13': (p) => p.relatedProducts.first() };
const CART_ANCHORS: Anchors<CheckoutPage> = { 'AX-09': (p) => p.header.cartLink };
const SIGN_IN_ANCHORS: Anchors<CheckoutPage> = {
  'AX-01': (p) => p.signIn.signInTab,
  'AX-02': (p) => p.signIn.signInTab,
  'AX-03': (p) => p.signIn.guestTab,
  'AX-12': (p) => p.signIn.signInTab,
};
const LOGIN_ANCHORS: Anchors<LoginPage> = { 'AX-04': (p) => [p.email.error, p.password.error, p.showPasswordButton] };
const REGISTER_ANCHORS: Anchors<RegisterPage> = { 'AX-10': (p) => [p.firstName.error, p.password.error, p.passwordRules.first()] };
const PROFILE_ANCHORS: Anchors<ProfilePage> = { 'AX-05': (p) => p.newPassword, 'AX-06': (p) => p.confirmNewPassword };
// The pill of the one mocked message; the message page shows it too and is watched by the baseline ratchet.
const INBOX_ANCHORS: Anchors<AdminListPage<AdminMessagePage>> = { 'AX-07': (p) => p.table.statusBadge(contactMessage.status) };

function anchorOf<Page>(anchors: Anchors<Page>, violation: PinnedViolation, page: Page): Anchor {
  const anchor = anchors[violation.id];
  if (!anchor) throw new Error(`A pin for ${violation.rule} on ${violation.target} has no anchor: name the element it is about`);
  return anchor(page);
}

/**
 * The other pages of a home-page pin's baseline entry that it reaches cheaply. AX-08 is on every
 * page of the site, so it is pinned on the home page alone and the ratchet watches the rest.
 */
function homeVisits(violation: PinnedViolation, homePage: HomePage, productName: string): Partial<Record<ScanName, Visit>> {
  if (violation.id !== 'AX-11') return {};
  const categories = homePage.filters.categories;
  return {
    'search results': async () => {
      await homePage.search.searchFor(productName);
      await expect(homePage.grid.cards.first()).toBeVisible();
      return categories;
    },
    'search without results': async () => {
      await homePage.search.searchFor(NO_SUCH_PRODUCT);
      await expect(homePage.grid.emptyState).toBeVisible();
      return categories;
    },
  };
}

// Before any navigation, on the context: the scan fixture refuses to read a page that may still be mid-fade.
test.use({ reducedMotion: 'reduce' });

test.describe('Known accessibility violations', { tag: ['@a11y', '@axe', '@bug'] }, () => {
  for (const violation of on('home')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (home)`, async ({ homePage, product, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      await expectFixed(a11y, violation, 'home', anchorOf(HOME_ANCHORS, violation, homePage), homeVisits(violation, homePage, product.name));
    });
  }

  for (const violation of on('product')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (product)`, async ({ productPage, catalog, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      await expectFixed(a11y, violation, 'product', anchorOf(PRODUCT_ANCHORS, violation, productPage), {
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
      // The same walk as the scan in pages.a11y.spec.ts: each visit builds on the one before.
      await expectFixed(a11y, violation, 'cart', anchorOf(CART_ANCHORS, violation, checkout), {
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
          await expect(checkout.payment.field(PAYMENT_FIELDS.cardNumber)).toBeVisible();
          return checkout.header.cartLink;
        },
      });
    });
  }

  for (const violation of on('checkout sign-in')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (checkout sign-in)`, async ({ checkout, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      await checkout.cart.proceed();
      await expectFixed(a11y, violation, 'checkout sign-in', anchorOf(SIGN_IN_ANCHORS, violation, checkout));
    });
  }

  for (const violation of on('login with errors')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (login)`, async ({ loginPage, shop, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      // The entry was recorded on the pages "with errors": the pin brings each to that state, as the scan does.
      await loginPage.loginButton.click();
      await expectFixed(a11y, violation, 'login with errors', anchorOf(LOGIN_ANCHORS, violation, loginPage), {
        'register with errors': async () => {
          // From `shop`, not the `registerPage` fixture, which would open /auth/register before this test opens the login page's own state.
          const registerPage = shop.register;
          await registerPage.open();
          await registerPage.submit();
          return [registerPage.firstName.error, registerPage.password.error, registerPage.showPasswordButton];
        },
      });
    });
  }

  for (const violation of on('register with errors')) {
    test(`${violation.id} ${violation.rule} on ${violation.target} (register)`, async ({ registerPage, a11y }) => {
      knownBug(violation.id, summaryOf(violation));
      // The entry was recorded on the page "with errors": the pin brings it to that state, as the scan does.
      await registerPage.submit();
      // Its other page, the profile, needs a mocked session and is watched by the baseline ratchet.
      await expectFixed(a11y, violation, 'register with errors', anchorOf(REGISTER_ANCHORS, violation, registerPage));
    });
  }

  test.describe('account (mocked session)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/totp/setup', {})));

    for (const violation of on('account profile')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (profile)`, async ({ profilePage, a11y }) => {
        knownBug(violation.id, summaryOf(violation));
        await expectFixed(a11y, violation, 'account profile', anchorOf(PROFILE_ANCHORS, violation, profilePage));
      });
    }
  });

  test.describe('back office (mocked admin)', { tag: ['@mocked'] }, () => {
    for (const violation of on('admin messages')) {
      test(`${violation.id} ${violation.rule} on ${violation.target} (admin inbox)`, async ({ adminMessages, a11y }) => {
        knownBug(violation.id, summaryOf(violation));
        await expectFixed(a11y, violation, 'admin messages', anchorOf(INBOX_ANCHORS, violation, adminMessages));
      });
    }
  });
});
