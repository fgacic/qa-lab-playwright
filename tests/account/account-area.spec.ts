import { expect, mock, test, withMocks } from '@fixtures';
import { ACCOUNT_TITLE } from '@pages/account/AccountPage';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { failureFeedback } from '@support/feedback';
import { apiPath } from '@support/env';
import { FAVORITE_ID, INVOICE_NUMBER, INVOICE_QUANTITY, fakeFavorite, fakeInvoice, fakeMessage, fakeReply, fakeUser, listOf } from '@support/payloads';
import { storedToken } from '@support/session';

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
      await expect(accountPage.title).toHaveText(ACCOUNT_TITLE);

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

    test('the customer lands on the login page', async ({ invoicesPage, shop, apiMock }) => {
      // The `invoicesPage` fixture opened /account/invoices with the refused token; its page is the one asserted on below.
      const { page } = invoicesPage;
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
});
