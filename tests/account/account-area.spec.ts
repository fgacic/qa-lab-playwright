import { expect, mock, test, withMocks } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { failureFeedback } from '@support/feedback';
import { apiPath } from '@support/env';
import { FAVORITE_ID, INVOICE_NUMBER, INVOICE_QUANTITY, fakeFavorite, fakeInvoice, fakeMessage, fakeReply, fakeUser, listOf } from '@support/payloads';
import { storedToken } from '@support/session';

const PROFILE_PATH = /^\/users\/[^/]+$/;
const [OLD_PASSWORD, NEW_PASSWORD, WRONG_PASSWORD] = ['Qa-lab-old-pass-1!', 'Qa-lab-new-pass-2!', 'Qa-lab-wrong-pass-1!'];
/** Both the profile and the password confirmations contain it; neither may appear after a refusal. */
const SAVED_NOTICE = 'successfully updated';

/**
 * The signed-in area with a mocked session: a fake token and mocked account endpoints, so it
 * runs anywhere without an account. The real thing is covered in real-account.spec.ts.
 */
test.describe('Account area (mocked session)', { tag: ['@mocked'] }, () => {
  // An account with nothing in it. Any section the SPA opens needs its endpoint mocked: the fake token
  // is refused by the real API (401), and the SPA does not handle that refusal (BUG-56, BUG-57: it sends the
  // user to a route that does not exist and keeps the session). Nested blocks replace this set.
  test.use(withMocks(
    mock.respond('GET', '/favorites', []),
    mock.respond('GET', '/invoices', listOf([])),
    mock.respond('GET', '/messages', listOf([])),
    mock.respond('POST', '/totp/setup', {}),
  ));

  const tiles = [['Favorites', '/account/favorites'], ['Profile', '/account/profile'], ['Invoices', '/account/invoices'], ['Messages', '/account/messages']] as const;
  for (const [section, path] of tiles) {
    test(`the account page links to ${section}`, async ({ accountPage, page }) => {
      await expect(accountPage.title).toHaveText('My account');

      await accountPage.openSection(section);

      await expect(page).toHaveURL(path);
    });
  }

  const menuItems = [['My favorites', '/account/favorites'], ['My profile', '/account/profile'], ['My invoices', '/account/invoices'], ['My messages', '/account/messages'], ['My account', '/account']] as const;
  for (const [item, path] of menuItems) {
    test(`the header account menu reaches "${item}"`, async ({ accountPage, page }) => {
      await expect(accountPage.header.userMenu).toHaveText(`${fakeUser.first_name} ${fakeUser.last_name}`);

      await accountPage.header.openUserMenuItem(item);

      await expect(page).toHaveURL(path);
    });
  }

  test.describe('sign out', () => {
    test('signing out forgets the session and sends the customer to login', async ({ accountPage, page }) => {
      await accountPage.header.openUserMenuItem('Sign out');

      await expect(page).toHaveURL('/auth/login');
      await expect(accountPage.header.userMenu).toHaveCount(0);
      await expect.poll(() => storedToken(page), { message: 'the stored token is gone' }).toBeNull();
    });

    test('"Sign out" is a real link or button', { tag: ['@a11y', '@bug'] }, async ({ accountPage }) => {
      knownBug('A11Y-04', '"Sign out" is an <a> without href: no link role, not reachable with Tab.');
      await accountPage.header.userMenu.click();
      // The item is there as text whatever its role: what is asserted below is that it is also a link or a button.
      await expect(accountPage.header.userMenuItem('Sign out')).toBeVisible();

      await expect(accountPage.header.signOutControl, 'A11Y-04: "Sign out" is a link or a button').toHaveCount(1, { timeout: BUG_TIMEOUT });
    });
  });

  test.describe('favorites', () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.sequence('GET', '/favorites', { status: 200, json: [fakeFavorite(product)] }, { status: 200, json: [] }), mock.respond('DELETE', /^\/favorites\/.+$/, '', 204)] });
      },
    });

    test('lists the favourite products and removes one', async ({ favoritesPage, catalog, apiMock }) => {
      const product = await catalog.inStock();
      await expect(favoritesPage.favorite(product.name)).toBeVisible();

      // The page lists once on opening and again after a removal: the sequence's second answer (empty) belongs
      // to that second list, so wait for it to be served before asserting what the page shows.
      const removal = apiMock.waitForRequest('DELETE', /^\/favorites\/.+$/);
      const relisted = apiMock.waitForResponse('GET', '/favorites');
      await favoritesPage.remove(product.name);

      expect(apiPath((await removal).url())).toBe(`/favorites/${FAVORITE_ID}`);
      await relisted;
      await expect(favoritesPage.favorites).toHaveCount(0);
      await expect(favoritesPage.emptyState).toBeVisible();
    });
  });

  // The shop answers 401 to a token it no longer accepts (expired, revoked): the same body for the real API and for this mock.
  test.describe('when the session is refused', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/invoices', 401, { error: 'Unauthorized' })));

    test('the customer lands on the login page', async ({ invoicesPage: _, shop, page, apiMock }) => {
      knownBug('BUG-56', 'a 401 on an account call sends the SPA to "/#/auth/login", which is not a route: the home page is shown at that address instead of the login form.');
      // Precondition, true whether or not the bug is fixed: the page asked for its list and was refused. (Not "the invoices page is
      // showing": the SPA leaves it as soon as the refusal arrives, so its heading is there only for a moment, or never.)
      await expect.poll(() => apiMock.answers, { message: 'the list was asked for and refused with 401' }).toContainEqual({ pathname: '/invoices', outcome: 401 });

      await expect(page, 'BUG-56: the refused customer is on /auth/login').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
      await expect(shop.login.heading, 'BUG-56: the login form is shown').toBeVisible({ timeout: BUG_TIMEOUT });
    });

    test('the stored token is dropped and the account menu goes', async ({ invoicesPage, page, apiMock }) => {
      knownBug('BUG-57', 'a 401 on an account call leaves the refused token in localStorage and the account menu in the header: the customer still looks signed in.');
      // Precondition, true whether or not the bug is fixed: the page asked for its list and was refused. (Not "the invoices page is
      // showing": the SPA leaves it as soon as the refusal arrives, so its heading is there only for a moment, or never.)
      await expect.poll(() => apiMock.answers, { message: 'the list was asked for and refused with 401' }).toContainEqual({ pathname: '/invoices', outcome: 401 });

      // The SPA leaves the page after the refusal (to the login route or to the address BUG-56 describes): read the token once it has.
      await expect(page, 'the refused customer leaves the invoices page').toHaveURL(/auth\/login/);

      await expect.poll(() => storedToken(page), { message: 'BUG-57: the refused token is gone', timeout: BUG_TIMEOUT }).toBeNull();
      await expect(invoicesPage.shell.header.userMenu, 'BUG-57: the account menu is gone').toHaveCount(0, { timeout: BUG_TIMEOUT });
    });
  });

  test.describe('with no favorites', () => {
    test.use(withMocks(mock.respond('GET', '/favorites', [])));

    test('the empty state explains how to add one', async ({ favoritesPage }) => {
      await expect(favoritesPage.emptyState).toContainText('please go to the product listing and mark some products as your favorite');
    });
  });

  test.describe('when favorites fail to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/favorites', 500)));

    test('the customer is told they could not be loaded', async ({ favoritesPage, page, apiMock }) => {
      knownBug('BUG-23', 'a failed favorites request says "There are no favorites yet", which is not true.', { absence: true });
      await expect(favoritesPage.title).toBeVisible();
      // Precondition, true whether or not the bug is fixed: the failure path ran (the page opened with the request already answered, so the mock's record is read).
      await expect.poll(() => apiMock.answers, { message: 'the list was asked for and refused with 500' }).toContainEqual({ pathname: '/favorites', outcome: 500 });

      await expect(failureFeedback(page).first(), 'BUG-23: the customer is told the favorites could not be loaded').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('invoices', () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const invoice = fakeInvoice(await catalog.inStock());
        await use({ routes: [
          mock.respond('GET', '/invoices', listOf([invoice])),
          mock.respond('GET', `/invoices/${invoice.id}`, invoice),
          // The details page polls for the PDF with the invoice number; the real backend would answer 401 to a fake session.
          mock.respond('GET', `/invoices/${invoice.invoice_number}/download-pdf-status`, { status: 'PROCESSING' }),
        ] });
      },
    });

    test('lists the orders and opens one with its lines', async ({ invoicesPage, catalog }) => {
      const product = await catalog.inStock();
      await expect(invoicesPage.invoice(INVOICE_NUMBER)).toContainText('$' + (product.price * INVOICE_QUANTITY).toFixed(2));

      const details = await invoicesPage.openDetails(INVOICE_NUMBER);

      await expect(details.downloadPdfButton).toBeVisible();
      await expect(await details.quantityOf(product.name)).toHaveText(String(INVOICE_QUANTITY));
    });
  });

  test.describe('with no invoices', () => {
    test.use(withMocks(mock.respond('GET', '/invoices', listOf([]))));

    test('the list is empty: no order rows and no failure notice', async ({ invoicesPage, page }) => {
      await expect(invoicesPage.title).toBeVisible();
      await expect(invoicesPage.table.getByRole('columnheader', { name: 'Invoice Number' })).toBeVisible();

      await expect(invoicesPage.invoiceRows).toHaveCount(0);
      await expect(failureFeedback(page)).toHaveCount(0);
    });

    test('the customer is told there are no invoices yet', { tag: ['@bug'] }, async ({ invoicesPage }) => {
      knownBug('BUG-48', 'an account with no invoices shows the bare table header and no empty-state text, unlike the favorites and messages pages.', { absence: true });
      await expect(invoicesPage.table.getByRole('columnheader', { name: 'Invoice Number' })).toBeVisible();
      await expect(invoicesPage.invoiceRows).toHaveCount(0);

      await expect(invoicesPage.emptyState, 'BUG-48: an empty invoice list says so').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when invoices fail to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/invoices', 500)));

    test('the customer is told they could not be loaded', async ({ invoicesPage, page, apiMock }) => {
      knownBug('BUG-24', 'a failed invoices request shows the bare page title, no table and no message.', { absence: true });
      await expect(invoicesPage.title).toBeVisible();
      // Precondition, true whether or not the bug is fixed: the failure path ran (the page opened with the request already answered, so the mock's record is read).
      await expect.poll(() => apiMock.answers, { message: 'the list was asked for and refused with 500' }).toContainEqual({ pathname: '/invoices', outcome: 500 });

      await expect(failureFeedback(page).first(), 'BUG-24: the customer is told the invoices could not be loaded').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('messages', () => {
    const REPLY = 'A mocked reply from the qa-lab suite.';
    // The page reloads the message after a reply, so the second answer lists it.
    test.use(withMocks(
      mock.respond('GET', '/messages', listOf([fakeMessage])),
      mock.sequence('GET', `/messages/${fakeMessage.id}`, { status: 200, json: fakeMessage }, { status: 200, json: { ...fakeMessage, replies: [fakeReply(REPLY)] } }),
    ));

    test('lists the contact messages, opens one and replies to it', async ({ messagesPage, apiMock }) => {
      await apiMock.use(mock.respond('POST', `/messages/${fakeMessage.id}/reply`, { id: '01QALABFAKEREPLY', message: 'ok' }, 201));
      await expect(messagesPage.messageRows).toHaveCount(1);

      const details = await messagesPage.openDetails(fakeMessage.subject);
      await expect(details.text(fakeMessage.message)).toBeVisible();
      await expect(details.repliesHeading).toBeVisible();

      // The message is read once on opening and again after the reply: wait for that second read, which lists the reply.
      const reply = apiMock.waitForRequest('POST', `/messages/${fakeMessage.id}/reply`);
      const reread = apiMock.waitForResponse('GET', `/messages/${fakeMessage.id}`);
      await details.sendReply(REPLY);

      expect((await reply).postDataJSON()).toEqual({ message: REPLY });
      await reread;
      await expect(details.text(REPLY)).toBeVisible();
      await expect(details.reply).toHaveValue('');
    });
  });

  test.describe('when messages fail to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/messages', 500)));

    test('the customer is told they could not be loaded', async ({ messagesPage, apiMock }) => {
      knownBug('BUG-49', 'a failed messages request says "There are no messages yet", which is not true.', { absence: true });
      await expect(messagesPage.title).toBeVisible();
      // Precondition, true whether or not the bug is fixed: the list was asked for and refused.
      await expect.poll(() => apiMock.answers, { message: 'the list was asked for and refused with 500' }).toContainEqual({ pathname: '/messages', outcome: 500 });

      await expect(failureFeedback(messagesPage.page).first(), 'BUG-49: the customer is told the messages could not be loaded').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when a reply fails', { tag: ['@bug'] }, () => {
    test.use(withMocks(
      mock.respond('GET', '/messages', listOf([fakeMessage])),
      mock.respond('GET', `/messages/${fakeMessage.id}`, fakeMessage),
      mock.fail('POST', `/messages/${fakeMessage.id}/reply`, 500),
    ));

    test('the customer is told the reply was not sent', async ({ messagesPage, apiMock }) => {
      knownBug('BUG-50', 'a reply the API refuses (500) is not reported: no alert, no message, and the reply box keeps its text without a word.', { absence: true });
      const details = await messagesPage.openDetails(fakeMessage.subject);
      const answered = apiMock.waitForResponse('POST', `/messages/${fakeMessage.id}/reply`);
      await details.sendReply('A reply the API refuses.');
      // Precondition, true whether or not the bug is fixed: the failure path ran.
      expect((await answered).response.status()).toBe(500);

      await expect(failureFeedback(messagesPage.page).first(), 'BUG-50: the customer is told the reply was not sent').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('with no messages', () => {
    test.use(withMocks(mock.respond('GET', '/messages', listOf([]))));

    test('the empty state points to the contact form', async ({ messagesPage }) => {
      await expect(messagesPage.emptyState).toContainText('Navigate to the contact form');
    });
  });

  test.describe('profile', () => {
    // Replaces the set above (a nested `test.use` does not merge), so the profile page's own POST /totp/setup needs its mock here too.
    test.use(withMocks(
      mock.respond('POST', '/totp/setup', {}),
      mock.respond('PUT', PROFILE_PATH, { success: true }),
      mock.respond('POST', '/users/change-password', { success: true }),
    ));

    test('shows the account\'s own details', async ({ profilePage }) => {
      await expect(profilePage.firstName.input).toHaveValue(fakeUser.first_name);
      await expect(profilePage.lastName.input).toHaveValue(fakeUser.last_name);
      await expect(profilePage.email.input).toHaveValue(fakeUser.email);
      await expect(profilePage.street.input).toHaveValue(fakeUser.address.street);
      await expect(profilePage.postalCode.input).toHaveValue(fakeUser.address.postal_code);
      await expect(profilePage.city.input).toHaveValue(fakeUser.address.city);
      await expect(profilePage.state.input).toHaveValue(fakeUser.address.state);
      await expect(profilePage.country.input).toHaveValue(fakeUser.address.country);
    });

    test('the profile page raises no application error', { tag: ['@bug'] }, async ({ profilePage, apiMock, consoleGuard }) => {
      knownBug('BUG-37', 'the profile page draws its two-factor QR code from an empty secret and logs "[angularx-qrcode] Field `qrdata` is empty" as an error on every visit.');
      // Precondition, true whether or not the bug is fixed: the page is filled in and its two-factor setup has been answered, so the QR widget has run.
      await expect(profilePage.email.input).toHaveValue(fakeUser.email);
      await expect.poll(() => apiMock.answers, { message: 'POST /totp/setup was answered' }).toContainEqual({ pathname: '/totp/setup', outcome: 200 });

      expect(await consoleGuard.logged(/angularx-qrcode/), 'BUG-37: the QR code widget logged an error').toEqual([]);
    });

    test('saving sends the edited profile', async ({ profilePage, apiMock }) => {
      const saved = apiMock.waitForRequest('PUT', PROFILE_PATH);
      await profilePage.firstName.input.fill('Renamed');

      await profilePage.update();

      expect((await saved).postDataJSON()).toMatchObject({ first_name: 'Renamed', last_name: fakeUser.last_name });
      await expect(profilePage.alerts.filter({ hasText: 'Your profile is successfully updated!' })).toBeVisible();
    });

    test('saving sends the edited address', async ({ profilePage, apiMock }) => {
      const saved = apiMock.waitForRequest('PUT', PROFILE_PATH);
      await profilePage.country.input.fill('BE');
      await profilePage.postalCode.input.fill('9000');
      await profilePage.state.input.fill('Oost-Vlaanderen');

      await profilePage.update();

      expect((await saved).postDataJSON().address).toEqual({ ...fakeUser.address, country: 'BE', postal_code: '9000', state: 'Oost-Vlaanderen' });
      await expect(profilePage.alerts.filter({ hasText: 'Your profile is successfully updated!' })).toBeVisible();
    });

    test('an empty postal code is stopped by the form', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await profilePage.postalCode.input.fill('');

      await profilePage.update();

      await expect(profilePage.alerts.filter({ hasText: 'Please correct the highlighted fields before saving.' })).toBeVisible();
      await apiMock.expectNoRequest('PUT', PROFILE_PATH);
    });

    test('answering a password change raises no application error', { tag: ['@bug'] }, async ({ profilePage, apiMock, consoleGuard }) => {
      knownBug('BUG-47', 'the profile page throws "TypeError: Cannot read properties of undefined (reading \'value\')" every time its change-password request is answered, although the page then shows the answer.');
      const answered = apiMock.waitForResponse('POST', '/users/change-password');

      await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);
      await answered;
      // Precondition, true whether or not the bug is fixed: the page took the answer in and shows it.
      await expect(profilePage.alerts.filter({ hasText: 'Your password is successfully updated!' })).toBeVisible();

      expect(await consoleGuard.logged(/TypeError:[^\n]*\bvalue\b/), 'BUG-47: the answer to a password change threw').toEqual([]);
    });

    test('changing the password sends the current and the new one', async ({ profilePage, apiMock }) => {
      const sent = apiMock.waitForRequest('POST', '/users/change-password');

      await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);

      expect((await sent).postDataJSON()).toEqual({
        current_password: OLD_PASSWORD,
        new_password: NEW_PASSWORD,
        new_password_confirmation: NEW_PASSWORD,
      });
      await expect(profilePage.alerts.filter({ hasText: 'Your password is successfully updated!' })).toBeVisible();
    });

    test('an empty password change is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ profilePage, apiMock }) => {
      knownBug('BUG-26', 'Change Password with every field empty is sent to the API instead of being validated in the form.', { absence: true });
      await expect(profilePage.changePasswordButton).toBeVisible();
      const before = await apiMock.mark();

      await profilePage.changePasswordButton.click();

      // The defect itself: the request leaves. Checked first, so a form that validates and a form that merely words the refusal differ.
      await expect(apiMock.expectNoRequest('POST', '/users/change-password', { since: before }), 'BUG-26: no request is sent').resolves.toBeUndefined();
      // And, once nothing is sent, the form says what is missing (the wording is a separate matter from the request).
      await expect(profilePage.alerts.filter({ hasText: /required/i }).first(), 'BUG-26: the form names the missing fields').toBeVisible({ timeout: BUG_TIMEOUT });
    });

    test('a confirmation that differs from the new password shows the API reason', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      // The real API answers 422 with this body (the form does not compare the two fields itself).
      await apiMock.use(mock.fail('POST', '/users/change-password', 422, {
        message: 'The new password field confirmation does not match.',
        errors: { new_password: ['The new password field confirmation does not match.'] },
      }));
      const sent = apiMock.waitForRequest('POST', '/users/change-password');

      await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD, WRONG_PASSWORD);

      expect((await sent).postDataJSON()).toMatchObject({ new_password: NEW_PASSWORD, new_password_confirmation: WRONG_PASSWORD });
      await expect(profilePage.alerts.filter({ hasText: 'The new password field confirmation does not match.' })).toBeVisible();
      await expect(profilePage.alerts.filter({ hasText: SAVED_NOTICE })).toHaveCount(0);
    });

    test('an empty first name is stopped by the form', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await profilePage.firstName.input.fill('');

      await profilePage.update();

      await expect(profilePage.alerts.filter({ hasText: 'Please correct the highlighted fields before saving.' })).toBeVisible();
      await apiMock.expectNoRequest('PUT', PROFILE_PATH);
    });

    // The email field is read-only on this page, so the profile's format check is exercised through the phone number.
    test('a malformed phone number is stopped by the form', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await profilePage.phone.input.fill('abc');

      await profilePage.update();

      await expect(profilePage.alerts.filter({ hasText: 'Please enter a valid phone number (digits, spaces and ( ) + - only).' })).toBeVisible();
      await apiMock.expectNoRequest('PUT', PROFILE_PATH);
    });

    test('a profile the API rejects shows its reason', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await apiMock.use(mock.fail('PUT', PROFILE_PATH, 422, { first_name: ['The first name field must not be greater than 40 characters.'] }));

      await profilePage.update();

      await expect(profilePage.alerts.filter({ hasText: 'The first name field must not be greater than 40 characters.' })).toBeVisible();
      await expect(profilePage.alerts.filter({ hasText: SAVED_NOTICE })).toHaveCount(0);
    });

    // The two ways a request fails besides a refusal with a reason: the API answers 500, or is not reached at all.
    test('saving the profile when the API answers 500 shows the failure, not a success', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await apiMock.use(mock.fail('PUT', PROFILE_PATH, 500));

      await profilePage.update();

      await expect(profilePage.alerts.filter({ hasText: 'Server Error' })).toBeVisible();
      await expect(profilePage.alerts.filter({ hasText: SAVED_NOTICE })).toHaveCount(0);
    });

    test('saving the profile when the API cannot be reached shows the failure, not a success', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await apiMock.use(mock.abort('PUT', PROFILE_PATH));
      const attempted = apiMock.waitForRequest('PUT', PROFILE_PATH);

      await profilePage.update();
      await attempted;

      await expect(profilePage.alerts.filter({ hasText: 'An unexpected error occurred.' })).toBeVisible();
      await expect(profilePage.alerts.filter({ hasText: SAVED_NOTICE })).toHaveCount(0);
    });

    test('changing the password when the API answers 500 shows the failure, not a success', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      await apiMock.use(mock.fail('POST', '/users/change-password', 500));

      await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);

      await expect(profilePage.alerts.filter({ hasText: 'Server Error' })).toBeVisible();
      await expect(profilePage.alerts.filter({ hasText: SAVED_NOTICE })).toHaveCount(0);
    });

    test('changing the password when the API cannot be reached tells the customer', { tag: ['@negative', '@bug'] }, async ({ profilePage, apiMock }) => {
      knownBug('BUG-51', 'a change-password request that never reaches the API is not reported: no alert, although a failed profile save says "An unexpected error occurred".', { absence: true });
      await apiMock.use(mock.abort('POST', '/users/change-password'));
      const attempted = apiMock.waitForRequest('POST', '/users/change-password');

      await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);
      await attempted;

      // Any alert but a success notice: a fixed page says the change failed, and a page that claimed success would not satisfy this.
      await expect(profilePage.alerts.filter({ hasNotText: SAVED_NOTICE }).first(), 'BUG-51: the customer is told the password was not changed').toBeVisible({ timeout: BUG_TIMEOUT });
    });

    test('a wrong current password shows the API reason', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
      // The real API answers 400 with this body.
      await apiMock.use(mock.fail('POST', '/users/change-password', 400, { success: false, message: 'Your current password does not matches with the password.' }));

      await profilePage.changePassword(WRONG_PASSWORD, NEW_PASSWORD);

      await expect(profilePage.alerts.filter({ hasText: 'Your current password does not matches with the password.' })).toBeVisible();
      await expect(profilePage.alerts.filter({ hasText: SAVED_NOTICE })).toHaveCount(0);
    });
  });
});
