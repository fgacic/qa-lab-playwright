import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { BUG_TIMEOUT } from '@support/known-bug';
import { applyTextSpacing, clippedText, horizontalOverflow, textLostBySpacing } from '@support/page-metrics';

/**
 * Two more things axe cannot say, because it reads one page at one size with one set of styles: the page at twice the size
 * (WCAG 1.4.4 resize text, 1.4.10 reflow) and with the text spacing a reader's stylesheet applies (1.4.12). The browser's own zoom is not
 * something a test can press, so 200% of a 1280 px screen is the same page in a 640 px wide viewport, which is what zoom does to the layout.
 * The 320 px phone width (400%) has its own checks in pages.a11y.spec.ts.
 * @axe: Chromium only, with the scans.
 */
const ZOOMED = { width: 640, height: 400 };

test.use({ reducedMotion: 'reduce' });

/** The page's width no larger than its screen, polled: a late image or a font swap can widen it a moment after the page is drawn. */
const expectNoSidewaysScroll = (page: Page, what: string) =>
  expect.poll(() => horizontalOverflow(page), { message: `${what} fits a ${ZOOMED.width}px screen without sideways scrolling`, timeout: BUG_TIMEOUT }).toBeLessThanOrEqual(0);

test.describe('Zoomed to 200%', { tag: ['@a11y', '@axe'] }, () => {
  test.use({ viewport: ZOOMED });

  test('the home page reflows, and the header still offers its menu', async ({ homePage, page }) => {
    await expect(homePage.grid.cards.first()).toBeVisible();
    await expect(homePage.shell.header.menuToggle, 'the header folds behind its toggler when there is no room for it').toBeVisible();

    await expectNoSidewaysScroll(page, 'the home page');
  });

  test('a product page reflows', async ({ productPage, page }) => {
    await expect(productPage.addToCartButton).toBeVisible();

    await expectNoSidewaysScroll(page, 'the product page');
  });

  test('the login form reflows', async ({ loginPage, page }) => {
    await expect(loginPage.loginButton).toBeVisible();

    await expectNoSidewaysScroll(page, 'the login page');
  });

  test('the contact form reflows', async ({ contactPage, page }) => {
    await expect(contactPage.sendButton).toBeVisible();

    await expectNoSidewaysScroll(page, 'the contact page');
  });

  test('the cart reflows', async ({ checkout, page }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(checkout.cart.proceedButton).toBeVisible();

    await expectNoSidewaysScroll(page, 'the cart');
  });
});

test.describe('With the text spacing of WCAG 1.4.12', { tag: ['@a11y', '@axe'] }, () => {
  /** Text the spacing cuts off, polled like the overflow checks above: a late image can still move the layout after the spacing is applied. */
  const expectNoTextLost = async (page: Page) => {
    const lost = await textLostBySpacing(page);
    await expect.poll(lost, { message: 'text cut off by its box once the spacing is applied' }).toEqual([]);
  };

  test('the home page loses no text', async ({ homePage, page }) => {
    await expect(homePage.grid.cards.first()).toBeVisible();

    await expectNoTextLost(page);
  });

  test('a product page loses no text', async ({ productPage, page }) => {
    await expect(productPage.addToCartButton).toBeVisible();

    await expectNoTextLost(page);
  });

  test('the login form loses no text', async ({ loginPage, page }) => {
    await expect(loginPage.loginButton).toBeVisible();

    await expectNoTextLost(page);
  });

  test('the contact form loses no text', async ({ contactPage, page }) => {
    await expect(contactPage.sendButton).toBeVisible();

    await expectNoTextLost(page);
  });

  test('the cart loses no text', async ({ checkout, page }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(checkout.cart.proceedButton).toBeVisible();

    await expectNoTextLost(page);
  });

  // Guards the guard: a check that lists nothing for any page would pass the five above for the wrong reason.
  test('the check lists a box that cuts its text and nothing else', async ({ page }) => {
    await page.setContent(`
      <main>
        <div id="cut" style="width:60px;height:20px;overflow:hidden;white-space:nowrap">A sentence much longer than its box</div>
        <div id="scrolls" style="width:60px;height:20px;overflow:auto;white-space:nowrap">A sentence much longer than its box</div>
        <div id="fits" style="width:300px;overflow:hidden">Short</div>
      </main>`);
    const before = await clippedText(page);
    await applyTextSpacing(page);

    expect(before, 'a box that hides its overflow and holds more than it shows, and no scrolling box or box that fits').toEqual(['div "A sentence much longer than its box"']);
    await expect(page.locator('body'), 'the spacing is applied to the page').not.toHaveCSS('letter-spacing', 'normal');
  });
});
