import { CartRow } from '@components/CartTable';
import { expect, mock, test, withMocks } from '@fixtures';
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
 * the first target that takes more than `within` presses from the one before it is out of reach (or out of order), and the walk stops there.
 * One press by default: a spec lists every stop of the stretch it walks, so an extra stop in between (a new link, a widget that
 * steals the focus) is reported, not absorbed.
 */
async function missedInTabOrder(page: Page, targets: { name: string; control: Locator }[], within = 1): Promise<string[]> {
  for (const { name, control } of targets) {
    let reached = false;
    for (let presses = 0; presses < within && !reached; presses++) {
      await page.keyboard.press('Tab');
      reached = await focusWithin(control);
    }
    if (!reached) return [`${name} was not reached within ${within} press(es) of Tab from the one before`];
  }
  return [];
}

test.describe('Keyboard: tab order', { tag: ['@a11y', '@axe'] }, () => {
  test('the header, then the sort and the price range, then the search, in reading order', async ({ homePage, page }) => {
    const { header } = homePage;
    await header.homeLink.focus();

    const missed = await missedInTabOrder(
      page,
      [
        { name: 'the Categories menu', control: header.categoriesButton },
        { name: 'Contact', control: header.contactLink },
        { name: 'Sign in', control: header.signInLink },
        { name: 'the language button', control: header.language.button },
        { name: 'the course promo link', control: homePage.shell.banners.coursePromoLink },
        { name: 'the sort list', control: homePage.filters.sort },
        { name: 'the minimum price slider', control: homePage.filters.minPrice },
        { name: 'the maximum price slider', control: homePage.filters.maxPrice },
        { name: 'the search box', control: homePage.search.query },
        { name: 'the search reset button', control: homePage.search.resetButton },
        { name: 'the search button', control: homePage.search.submitButton },
      ],
    );

    expect(missed, 'Tab follows the reading order of the home page').toEqual([]);
  });

  test('the login form, field by field, down to its links', async ({ loginPage, page }) => {
    await loginPage.email.input.focus();

    const missed = await missedInTabOrder(
      page,
      [
        { name: 'the password', control: loginPage.password.input },
        { name: 'the show-password button', control: loginPage.showPasswordButton },
        { name: 'the Login button', control: loginPage.loginButton },
        { name: 'the register link', control: loginPage.registerLink },
        { name: 'the forgot-password link', control: loginPage.forgotPasswordLink },
      ],
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
    );

    expect(missed, 'Tab follows the order of the product page controls').toEqual([]);
  });

  test('the cart: the quantity, then Continue Shopping and Proceed to checkout', async ({ checkout, page }) => {
    const { cart } = checkout;
    await expect(cart.table.rows).toHaveCount(1);
    await new CartRow(cart.table.rows.first()).quantity.focus();

    // Two presses allowed for the first stop: the line's remove control (A11Y-01, not focusable today) would sit between the quantity and the buttons.
    const missed = await missedInTabOrder(
      page,
      [
        { name: 'Continue Shopping', control: cart.continueShoppingButton },
        { name: 'Proceed to checkout', control: cart.proceedButton },
      ],
      2,
    );

    expect(missed, 'Tab goes from the quantity to the buttons under the cart').toEqual([]);
  });

  test('the checkout sign-in step: the two tabs, then the sign-in form down to its links', async ({ checkout, page }) => {
    await checkout.cart.proceed();
    await expect(checkout.signIn.signInTab).toBeVisible();
    await checkout.signIn.signInTab.focus();

    const missed = await missedInTabOrder(
      page,
      [
        { name: 'the Continue as Guest tab', control: checkout.signIn.guestTab },
        { name: 'the email field', control: checkout.signIn.email.input },
        { name: 'the password field', control: checkout.signIn.password.input },
        { name: 'the Login button', control: checkout.signIn.loginButton },
      ],
    );

    expect(missed, 'Tab reaches the checkout sign-in step in its reading order').toEqual([]);
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

  test('the cart draws a focus indicator on its quantity and its two buttons', async ({ checkout, page }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await page.keyboard.press('Tab');
    const controls: [string, Locator][] = [
      ['the quantity', new CartRow(checkout.cart.table.rows.first()).quantity],
      ['Continue Shopping', checkout.cart.continueShoppingButton],
      ['Proceed to checkout', checkout.cart.proceedButton],
    ];

    for (const [name, control] of controls) {
      await expect.poll(() => focusRingDrawn(page, control), { message: `${name} looks different when it has the keyboard focus` }).toBe(true);
    }
  });
});

test.describe('Keyboard: the focus-indicator check itself', { tag: ['@a11y', '@axe'] }, () => {
  // Guards the guard: a check that says "drawn" for everything would pass the page above for the wrong reason.
  test('tells a ring from a control with its outline removed', async ({ page }) => {
    await page.setContent(`
      <style>#bare:focus, #bare:focus-visible { outline: none; box-shadow: none }
             #ringed:focus { outline: 3px solid #c00; outline-offset: 2px }
             #shadowed:focus { outline: none; box-shadow: 0 0 0 3px #06c }</style>
      <main><button id="bare">Bare</button> <button id="ringed">Ringed</button> <button id="shadowed">Shadowed</button></main>`);

    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Ringed' })), 'a button with an outline on focus').toBe(true);
    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Shadowed' })), 'a button with a shadow ring on focus').toBe(true);
    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Bare' })), 'a button with its focus outline removed').toBe(false);
  });

  test('does not take another change of pixels for a ring', async ({ page }) => {
    // Each of these changes pixels when it has the focus and draws no ring: the label's colour, a mark in one corner, and a hint beside the button.
    await page.setContent(`
      <style>button { outline: none; padding: 12px 24px }
             #recolour:focus { color: #c00 }
             #corner { position: relative } #corner:focus::after { content: ''; position: absolute; top: 0; right: 0; width: 10px; height: 10px; background: #c00 }
             #hint:focus + span { visibility: visible } #hint + span { visibility: hidden; display: inline-block; width: 40px; height: 20px; background: #c00 }</style>
      <main><button id="recolour">Recolour</button> <button id="corner">Corner</button> <button id="hint">Hint</button><span></span></main>`);

    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Recolour' })), 'a button whose label changes colour').toBe(false);
    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Corner' })), 'a button with a mark in one corner').toBe(false);
    expect(await focusRingDrawn(page, page.getByRole('button', { name: 'Hint' })), 'a button with a hint appearing beside it').toBe(false);
  });

  test('refuses to judge a region that changes on its own', async ({ page }) => {
    await page.setContent(`
      <button id="busy">Busy</button><div id="blink" style="width:40px;height:20px"></div>
      <script>const blink = document.getElementById('blink');
        // A different grey every frame: two reads taken apart in time never meet on the same one.
        const paint = () => { blink.style.background = 'rgb(' + (Date.now() % 251) + ',0,0)'; requestAnimationFrame(paint) }; paint()</script>`);

    await expect(focusRingDrawn(page, page.getByRole('button', { name: 'Busy' }))).rejects.toThrow('changes on its own');
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

test.describe('Keyboard: the account menu', { tag: ['@a11y', '@axe', '@mocked'] }, () => {
  test.use(withMocks(mock.respond('GET', '/favorites', [])));

  test('opens with Enter, Tab walks its links, and Escape closes it with the focus back on its button', async ({ accountPage, page }) => {
    const { header } = accountPage.shell;
    await header.userMenu.focus();
    await page.keyboard.press('Enter');
    await expect(header.userMenuItem('My account')).toBeVisible();

    // "Sign out" is not a stop (A11Y-04, pinned in account-area): the walk is the five links above it.
    const missed = await missedInTabOrder(
      page,
      (['My account', 'My favorites', 'My profile', 'My invoices', 'My messages'] as const).map((name) => ({ name, control: header.userMenuItem(name) })),
    );
    expect(missed, 'Tab goes down the account menu in the order it is drawn').toEqual([]);

    await header.userMenu.focus();
    await page.keyboard.press('Escape');

    await expect(header.userMenuItem('My account')).toBeHidden();
    await expect(header.userMenu).toBeFocused();
  });

  test('every link of the account menu draws a focus indicator', async ({ accountPage, page }) => {
    const { header } = accountPage.shell;
    await header.userMenu.focus();
    await page.keyboard.press('Enter');
    await expect(header.userMenuItem('My account')).toBeVisible();

    for (const name of ['My account', 'My favorites', 'My profile', 'My invoices', 'My messages'] as const) {
      await expect.poll(() => focusRingDrawn(page, header.userMenuItem(name)), { message: `${name} looks different when it has the keyboard focus` }).toBe(true);
    }
  });
});
