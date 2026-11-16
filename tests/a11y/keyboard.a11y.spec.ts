import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { focusRingDrawn, focusWithin } from '@support/focus';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/**
 * What axe cannot say, because it reads one frozen page: whether the keyboard gets through it. Tab order follows the reading
 * order of the main pages (WCAG 2.4.3), every control shown to the keyboard draws a focus indicator (2.4.7), and the shop's menus
 * and widgets take the keyboard in and give it back. No scan, no baseline: a failure here is a defect of its own, pinned below.
 * @axe: Chromium only, with the scans. Tab stops differ between engines (WebKit skips links unless the system setting says
 * otherwise), so the order is held for one.
 */
test.use({ reducedMotion: 'reduce' });

/**
 * Presses Tab until each target has the focus, in this order. Returns what was not reached, as a list for the spec to assert on:
 * the first target that takes more than `within` presses is out of reach (or out of order), and the walk stops there.
 */
async function missedInTabOrder(page: Page, targets: { name: string; control: Locator }[], within: number): Promise<string[]> {
  for (const { name, control } of targets) {
    let reached = false;
    for (let presses = 0; presses < within && !reached; presses++) {
      await page.keyboard.press('Tab');
      reached = await focusWithin(control);
    }
    if (!reached) return [`${name} was not reached within ${within} presses of Tab`];
  }
  return [];
}

test.describe('Keyboard: tab order', { tag: ['@a11y', '@axe'] }, () => {
  test('the header, then the sort, then the search, in reading order', async ({ homePage, page }) => {
    const { header } = homePage;
    await header.homeLink.focus();

    const missed = await missedInTabOrder(
      page,
      [
        { name: 'the Categories menu', control: header.categoriesButton },
        { name: 'Contact', control: header.contactLink },
        { name: 'Sign in', control: header.signInLink },
        { name: 'the language button', control: header.language.button },
        { name: 'the sort list', control: homePage.filters.sort },
        { name: 'the search box', control: homePage.search.query },
        { name: 'the search button', control: homePage.search.submitButton },
      ],
      8,
    );

    expect(missed, 'Tab follows the reading order of the home page').toEqual([]);
  });

  test('the login form, field by field, down to its links', async ({ loginPage, page }) => {
    await loginPage.email.input.focus();

    const missed = await missedInTabOrder(
      page,
      [
        { name: 'the password', control: loginPage.password.input },
        { name: 'the Login button', control: loginPage.loginButton },
        { name: 'the register link', control: loginPage.registerLink },
        { name: 'the forgot-password link', control: loginPage.forgotPasswordLink },
      ],
      3,
    );

    expect(missed, 'Tab follows the order of the login form').toEqual([]);
  });

  test('the product page: quantity, then add to cart, favourites and compare', async ({ productPage, page }) => {
    await productPage.decreaseQuantityButton.focus();

    const missed = await missedInTabOrder(
      page,
      [
        { name: 'the quantity', control: productPage.quantity },
        { name: 'the increase button', control: productPage.increaseQuantityButton },
        { name: 'Add to cart', control: productPage.addToCartButton },
        { name: 'Add to favourites', control: productPage.addToFavouritesButton },
        { name: 'Compare', control: productPage.compareButton },
      ],
      2,
    );

    expect(missed, 'Tab follows the order of the product page controls').toEqual([]);
  });
});

test.describe('Keyboard: focus is visible', { tag: ['@a11y', '@axe'] }, () => {
  test('every header control and the first controls of the listing draw a focus indicator', async ({ homePage, page }) => {
    const { header } = homePage;
    const controls: [string, Locator][] = [
      ['Home', header.homeLink],
      ['the Categories menu', header.categoriesButton],
      ['Contact', header.contactLink],
      ['Sign in', header.signInLink],
      ['the language button', header.language.button],
      ['the sort list', homePage.filters.sort],
      ['the search box', homePage.search.query],
      ['the search button', homePage.search.submitButton],
      ['the first product', homePage.grid.cards.first()],
      ['the next page button', homePage.pagination.next],
    ];
    // Arrived at by keyboard, as the focus-visible rules of a stylesheet expect.
    await page.keyboard.press('Tab');
    await expect(homePage.grid.cards.first()).toBeVisible();

    for (const [name, control] of controls) {
      await expect.poll(() => focusRingDrawn(page, control), { message: `${name} looks different when it has the keyboard focus` }).toBe(true);
    }
  });

  test('the login form draws a focus indicator on its fields, button and link', async ({ loginPage, page }) => {
    await page.keyboard.press('Tab');
    const controls: [string, Locator][] = [
      ['the email field', loginPage.email.input],
      ['the password field', loginPage.password.input],
      ['the Login button', loginPage.loginButton],
      ['the register link', loginPage.registerLink],
    ];

    for (const [name, control] of controls) {
      await expect.poll(() => focusRingDrawn(page, control), { message: `${name} looks different when it has the keyboard focus` }).toBe(true);
    }
  });
});

test.describe('Keyboard: the focus-indicator check itself', { tag: ['@a11y', '@axe'] }, () => {
  // Guards the guard: a check that says "drawn" for everything would pass the page above for the wrong reason.
  test('tells a control with a ring from one with its outline removed', async ({ page }) => {
    await page.setContent(`
      <style>#bare:focus, #bare:focus-visible { outline: none; box-shadow: none }
             #ringed:focus { outline: 3px solid #c00; outline-offset: 2px }</style>
      <main><button id="bare">Bare</button> <button id="ringed">Ringed</button></main>`);

    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Ringed' })), 'a button with an outline on focus').toBe(true);
    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Bare' })), 'a button with its focus outline removed').toBe(false);
  });
});

test.describe('Keyboard: menus and widgets', { tag: ['@a11y', '@axe'] }, () => {
  test('the language menu opens with Enter and closes with Escape, and the focus stays on its button', async ({ homePage, page }) => {
    const { language } = homePage.header;
    await language.button.focus();
    await page.keyboard.press('Enter');
    await expect(language.menu).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(language.menu).toBeHidden();
    await expect(language.button).toBeFocused();
  });

  test('the categories menu opens with Enter and closes with Escape, and the focus stays on its button', async ({ homePage, page }) => {
    const { header } = homePage;
    await header.categoriesButton.focus();
    await page.keyboard.press('Enter');
    await expect(header.categoryLink('Hand Tools')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(header.categoryLink('Hand Tools')).toBeHidden();
    await expect(header.categoriesButton).toBeFocused();
  });

  test('AX-14 opening the chat with the keyboard puts the focus in its window', { tag: ['@bug'] }, async ({ homePage, page }) => {
    knownBug('AX-14', 'opening the chat with Enter leaves the keyboard focus on the page body: the button that had it is gone and nothing in the window takes it (WCAG 2.4.3)');
    const { chat } = homePage.shell;
    await chat.openButton.focus();
    await page.keyboard.press('Enter');
    await expect(chat.window).toBeVisible();

    await expect.poll(() => focusWithin(chat.window), { message: 'AX-14: the keyboard focus is inside the chat window once it is open', timeout: BUG_TIMEOUT }).toBe(true);
  });
});
