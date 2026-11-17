import { expect, test } from '@playwright/test';
import { untranslatedKeys, visibleUiText } from '@support/i18n';

/**
 * The leaked-key detector, on text the shop really renders: a key is flagged wherever it is
 * shown, and an email, a URL, a price, a version or an abbreviation is not mistaken for one.
 * Mostly no page is opened (so `test` comes from Playwright itself, not the suite's page fixtures): this guards the guard.
 * The one exception reads a page the test builds from a string, to guard how a read labels the text it finds.
 * @i18n: Chromium only, with the rest of the translation checks.
 */
test.describe('Leaked translation keys are recognised', { tag: ['@i18n'] }, () => {
  test('single-dot and deeper keys are flagged, alone or in a sentence', () => {
    expect(untranslatedKeys(['nav.home', 'page.forgot-password.confirm', 'Error: pagination.next failed', 'Sign in (login.title)'])).toEqual([
      'nav.home',
      'page.forgot-password.confirm',
      'pagination.next',
      'login.title',
    ]);
  });

  test('keys with digits, camelCase or a capital are flagged too', () => {
    expect(untranslatedKeys(['errors.404.title', 'page.forgotPassword', 'nav.Home', 'Oops: errors.404.title.', 'cart.items.2'])).toEqual([
      'errors.404.title',
      'page.forgotPassword',
      'nav.Home',
      'errors.404.title',
      'cart.items.2',
    ]);
  });

  // The edges of the pattern, each of which a narrower detector missed: a camelCase or upper-case first
  // segment, a key glued to punctuation, a key that starts with a digit, and a key that is all there is.
  test('keys at the limits of the pattern are flagged', () => {
    expect(untranslatedKeys(['navBar.home', 'NAV.HOME', 'Error:nav.home', '(nav.home)', '"nav.home"', 'nav.home,', '2fa.title'])).toEqual([
      'navBar.home',
      'NAV.HOME',
      'nav.home',
      'nav.home',
      'nav.home',
      'nav.home',
      '2fa.title',
    ]);
    expect(untranslatedKeys(['nav.home'])).toEqual(['nav.home']);
  });

  test('a key and a real address in one text are told apart', () => {
    expect(untranslatedKeys(['Write to info@testsmith.io or see nav.home', 'Visit www.practicesoftwaretesting.com, then login.title'])).toEqual(['nav.home', 'login.title']);
  });

  // One shape the detector is built not to flag, pinned so a change to it is a decision and not an accident: a key whose
  // only other segment is a number ("errors.404") looks like a decimal, a version or an order number ("12.345", "2.5kg",
  // "v5.3.1"). The limit ends at a longer name, which is flagged. The abbreviations the shop's text holds are listed by name
  // ("e.g", "i.e", "d.h", "z.B", "π.χ", "U.S"), so a key of two short segments ("ui.ok") is flagged.
  test('documented limit: a key with one number segment is not flagged', () => {
    expect(untranslatedKeys(['errors.404'])).toEqual([]);
    expect(untranslatedKeys(['errors.notFound', 'ui.okay', 'errors.404.title'])).toEqual(['errors.notFound', 'ui.okay', 'errors.404.title']);
  });

  test('a key of two short segments is flagged, an abbreviation is not', () => {
    expect(untranslatedKeys(['ui.ok', 'nav.go', 'id.no', 'e.g', 'i.e', 'd.h', 'z.B', 'π.χ', 'U.S'])).toEqual(['ui.ok', 'nav.go', 'id.no']);
  });

  test('real page text holds no key', () => {
    const real = [
      'Have at least one special symbol (e.g., @, #, $, etc.)',
      'Please enter a valid date in YYYY-MM-DD format.',
      'Contact us at info [at] testsmith [dot] io.',
      'Email: testy.mctestface@example.com',
      'Visit https://www.practicesoftwaretesting.com/privacy or api.practicesoftwaretesting.com',
      'Total $1,234.56 (incl. 21.0% VAT), 0.5 kg',
      'Toolshop v5.3.1, build 2026.11.04',
      'Attachment: only .txt files (max. 250 KB), e.g. notes.txt',
      'Effective Date: Nov. 4, 2026. Thank you.',
      'Greek (π.χ. αυτό) and German (d.h. dies, z. B. das)',
      // The footer's build line, a version, a decimal, an ordinal date and a sentence run into the next without a space.
      'vdev | Built 2026-07-07 | Angular 20.0.5',
      'Running v5.3.1 on port 4200',
      'Order no. 12.345, weight 2.5kg, Error 404.',
      'Open Mon.-Fri. 9.00-17.00 or call 0800.123.456',
    ];

    // One input at a time, so a flagged one is named by its own text and not lost in a diff.
    for (const text of real) expect.soft(untranslatedKeys([text]), text).toEqual([]);
  });

  // Documented gap: with no dot, a key cannot be told from a word ("home", "login_title"). It is not flagged here; a leaked
  // single-segment key is found by the stray-English comparison (it equals English), which is why that check exists beside this one.
  test('documented gap: a key of one segment is not flagged', () => {
    expect(untranslatedKeys(['home', 'HOME', 'nav-home', 'login_title', 'nav_home'])).toEqual([]);
    // The same word glued to a second segment is a key again: the gap is exactly "no dot".
    expect(untranslatedKeys(['home.title', 'login_title.text'])).toEqual(['home.title', 'login_title.text']);
  });
});

test.describe('The UI text read from a page', { tag: ['@i18n'] }, () => {
  test('a string in the header and in the page is the page\'s', async ({ page }) => {
    // The header's copy comes first in the document: the label of the string must not stay "shell" because that is the one read first.
    await page.setContent(`
      <title>Shared</title>
      <app-header><a href="#">Contact</a><span>Only in the header</span></app-header>
      <main><h1>Contact</h1><p>Only in the page</p></main>
      <app-footer><span>Only in the footer</span></app-footer>`);

    const read = await visibleUiText(page);
    const partOf = (text: string) => read.find((t) => t.kind === 'text' && t.text === text)?.part;

    expect(partOf('Contact')).toBe('page');
    expect(partOf('Only in the header')).toBe('shell');
    expect(partOf('Only in the page')).toBe('page');
    expect(partOf('Only in the footer')).toBe('shell');
  });

  test('every kind of UI text is read once, under its own kind, and what is not drawn is skipped', async ({ page }) => {
    // One element for each place a visitor, a screen reader or the browser takes words from, and the ones that must stay unread: the
    // text of an element that is not drawn, a value of one character, a number, and a closed dropdown's items (which are read: the
    // menu is part of the page, only its toggle must show).
    await page.setContent(`
      <title>Document title</title>
      <main>
        <p>Plain text</p>
        <input placeholder="Placeholder text" aria-label="Label text" aria-description="Description text" aria-placeholder="Aria placeholder text" title="Title text">
        <div role="slider" aria-valuetext="Value text" aria-roledescription="Role description text" aria-errormessage="none"></div>
        <img src="data:," alt="Alt text">
        <input type="image" src="data:," alt="Image button alt">
        <input type="submit" value="Submit value">
        <select><option>Option text</option></select>
        <div class="dropdown"><button>Toggle</button><ul class="dropdown-menu" style="display:none"><li>Menu item text</li></ul></div>
        <p style="display:none">Hidden text</p>
        <button aria-label="Hidden label" style="visibility:hidden">x</button>
        <p>€</p><p>1234</p>
      </main>`);

    const read = await visibleUiText(page);
    const seen = read.map(({ kind, text }) => `${kind}: ${text}`);

    expect(seen.sort()).toEqual(
      [
        'page-title: Document title',
        'text: Plain text',
        'text: Toggle',
        'text: Menu item text',
        'placeholder: Placeholder text',
        'aria-label: Label text',
        'aria-description: Description text',
        'aria-placeholder: Aria placeholder text',
        'title: Title text',
        'aria-valuetext: Value text',
        'aria-roledescription: Role description text',
        'alt: Alt text',
        'alt: Image button alt',
        'value: Submit value',
        'option: Option text',
      ].sort(),
    );
  });

  test('a card with a picture holds data both scans skip, a card without one is the shop\'s own words', async ({ page }) => {
    await page.setContent(`
      <main>
        <div class="card"><img src="data:," alt="Claw hammer"><h5 class="card-title">Claw Hammer</h5><p class="card-text">A hammer for nails</p></div>
        <div class="card"><h5 class="card-title">account.favorites.title</h5><p class="card-text">account.favorites.text</p></div>
        <figure><img src="data:," alt="Tool"><figcaption>photo.credit</figcaption></figure>
      </main>`);

    const keys = (await visibleUiText(page, 'keys')).map((t) => t.text);
    const strays = (await visibleUiText(page, 'strays')).map((t) => t.text);

    expect(keys, 'the key scan reads the tile and the credit, not the product card').toEqual(expect.arrayContaining(['account.favorites.title', 'account.favorites.text', 'photo.credit']));
    expect(keys).not.toContain('Claw Hammer');
    expect(keys).not.toContain('A hammer for nails');
    // Both scans skip the same product card; the stray-English scan also skips the credit (the same name in every language), and reads the tile.
    expect(strays, 'the stray-English scan reads the tile, and skips the product card and the credit').toEqual(['account.favorites.title', 'account.favorites.text']);
  });

  test('a plain cell of an account list is data to the stray-English scan, and read by the key scan', async ({ page }) => {
    await page.setContent(`
      <main>
        <table class="table-hover"><tbody><tr>
          <td>Customer wrote this</td><td>invoice.total.label</td>
          <td><span class="badge">invoice.status.badge</span></td><td><a href="#">invoice.details.link</a></td>
        </tr></tbody></table>
      </main>`);

    const keys = (await visibleUiText(page, 'keys')).map((t) => t.text);
    const strays = (await visibleUiText(page, 'strays')).map((t) => t.text);

    expect(keys, 'the key scan reads every cell: a leaked key in a record is still a defect').toEqual(expect.arrayContaining(['Customer wrote this', 'invoice.total.label', 'invoice.status.badge', 'invoice.details.link']));
    expect(strays, 'the stray-English scan skips the plain cells and reads the badge and the link, which are the shop\'s words').toEqual(['invoice.status.badge', 'invoice.details.link']);
  });
});
